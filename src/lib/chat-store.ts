import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Turn } from "./chat-types";

export class ChatError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const columns = `id, content, reply, status, error, attempt, model,
  prompt_tokens AS promptTokens, completion_tokens AS completionTokens,
  created_at AS createdAt, updated_at AS updatedAt`;

export class ChatStore {
  readonly db: DatabaseSync;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "opendot.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('pending', 'complete', 'failed')),
        error TEXT, attempt INTEGER NOT NULL DEFAULT 1, model TEXT NOT NULL DEFAULT '',
        prompt_tokens INTEGER, completion_tokens INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_turn ON turns(status) WHERE status = 'pending';
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
    `);
  }

  private expire() {
    this.db
      .prepare(
        "UPDATE turns SET status = 'failed', error = '回复中断，请重试' WHERE status = 'pending' AND updated_at < ?",
      )
      .run(Date.now() - 120_000);
  }

  history(): Turn[] {
    this.expire();
    return (
      this.db
        .prepare(`SELECT ${columns} FROM turns ORDER BY rowid DESC LIMIT 200`)
        .all() as Turn[]
    ).reverse();
  }

  begin(
    id: string,
    content: string,
    retry = false,
  ): Turn & { started: boolean } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.expire();
      const existing = this.db
        .prepare(`SELECT ${columns} FROM turns WHERE id = ?`)
        .get(id) as Turn | undefined;
      if (existing && existing.content !== content)
        throw new ChatError("重复请求的消息内容不一致", 409);
      if (existing && (existing.status !== "failed" || !retry)) {
        this.db.exec("COMMIT");
        return { ...existing, started: false };
      }
      if (
        this.db.prepare("SELECT id FROM turns WHERE status = 'pending'").get()
      ) {
        throw new ChatError("小点正在回复，请等待本次完成", 409);
      }
      // Retrying an older turn would append a reply after newer context was sent.
      const latest = this.db
        .prepare("SELECT id FROM turns ORDER BY rowid DESC LIMIT 1")
        .get();
      if (existing && latest?.id !== id)
        throw new ChatError("已有后续消息，请重新发送这个问题", 409);
      const now = Date.now();
      if (existing) {
        this.db
          .prepare(
            "UPDATE turns SET status = 'pending', reply = '', error = NULL, attempt = attempt + 1, updated_at = ? WHERE id = ?",
          )
          .run(now, id);
      } else {
        this.db
          .prepare(
            "INSERT INTO turns(id, content, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)",
          )
          .run(id, content, now, now);
      }
      const turn = this.db
        .prepare(`SELECT ${columns} FROM turns WHERE id = ?`)
        .get(id) as Turn;
      this.db.exec("COMMIT");
      return { ...turn, started: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  partial(id: string, attempt: number, reply: string) {
    this.db
      .prepare(
        "UPDATE turns SET reply = ?, updated_at = ? WHERE id = ? AND attempt = ? AND status = 'pending'",
      )
      .run(reply, Date.now(), id, attempt);
  }

  complete(
    id: string,
    attempt: number,
    reply: string,
    model: string,
    usage: { prompt_tokens?: number; completion_tokens?: number },
  ) {
    this.db
      .prepare(
        `UPDATE turns SET reply = ?, model = ?, prompt_tokens = ?, completion_tokens = ?, status = 'complete', error = NULL, updated_at = ?
      WHERE id = ? AND attempt = ? AND status = 'pending'`,
      )
      .run(
        reply,
        model,
        usage.prompt_tokens ?? null,
        usage.completion_tokens ?? null,
        Date.now(),
        id,
        attempt,
      );
  }

  fail(id: string, attempt: number, error: string) {
    this.db
      .prepare(
        "UPDATE turns SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND attempt = ? AND status = 'pending'",
      )
      .run(error, Date.now(), id, attempt);
  }

  context(): { role: "user" | "assistant"; content: string }[] {
    const turns = this.db
      .prepare(
        "SELECT content, reply FROM turns WHERE status = 'complete' ORDER BY rowid DESC LIMIT 20",
      )
      .all()
      .reverse();
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    let characters = 0;
    for (const turn of turns.reverse()) {
      const size = String(turn.content).length + String(turn.reply).length;
      if (characters + size > 48000) break;
      characters += size;
      messages.unshift(
        { role: "user", content: String(turn.content) },
        { role: "assistant", content: String(turn.reply) },
      );
    }
    return messages;
  }
}

let singleton: ChatStore | undefined;
export function getStore() {
  singleton ??= new ChatStore(
    process.env.DATA_DIR || join(process.cwd(), "data"),
  );
  return singleton;
}
