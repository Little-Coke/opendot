import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { ChatError } from "./chat-store";
import {
  DOT_LIMIT,
  type CustomDot,
  isCustomDotId,
  isDotColor,
  isDotShape,
  parseDotInput,
} from "./dot-profile";

const columns = `id, name, shape, color, role,
  created_at AS createdAt, updated_at AS updatedAt`;

type Row = {
  id: string;
  name: string;
  shape: string;
  color: string;
  role: string;
  createdAt: number;
  updatedAt: number;
};

function mapRow(row: Row): CustomDot | undefined {
  if (!isDotShape(row.shape) || !isDotColor(row.color)) return undefined;
  return {
    id: row.id,
    name: row.name,
    shape: row.shape,
    color: row.color,
    role: row.role,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

/** 自定义 Dot 存在数据卷的 dots.sqlite，不写入聊天库。 */
export class DotStore {
  readonly db: DatabaseSync;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const databasePath = join(directory, "dots.sqlite");
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS dots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        shape TEXT NOT NULL,
        color TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    for (const suffix of ["-wal", "-shm"]) {
      try {
        chmodSync(`${databasePath}${suffix}`, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  list(): CustomDot[] {
    const rows = this.db
      .prepare(`SELECT ${columns} FROM dots ORDER BY created_at ASC, rowid ASC`)
      .all() as Row[];
    return rows.flatMap((row) => {
      const dot = mapRow(row);
      return dot ? [dot] : [];
    });
  }

  get(id: string): CustomDot | undefined {
    if (!isCustomDotId(id)) return undefined;
    const row = this.db.prepare(`SELECT ${columns} FROM dots WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  create(input: unknown): CustomDot {
    const parsed = parseDotInput(input);
    if (!parsed.ok) throw new ChatError(parsed.error);
    let id = "";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT COUNT(*) AS count FROM dots").get() as {
        count: number;
      };
      if (Number(row.count) >= DOT_LIMIT) {
        throw new ChatError(`最多保存 ${DOT_LIMIT} 个自定义 Dot`);
      }
      id = this.allocateId();
      const now = Date.now();
      this.db
        .prepare(
          "INSERT INTO dots(id, name, shape, color, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          parsed.value.name,
          parsed.value.shape,
          parsed.value.color,
          parsed.value.role,
          now,
          now,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // 事务可能尚未开始。
      }
      throw error;
    }
    const created = this.get(id);
    if (!created) throw new ChatError("Dot 已写入但无法读取", 500);
    return created;
  }

  remove(id: string) {
    if (!isCustomDotId(id)) throw new ChatError("没有这个 Dot", 404);
    const result = this.db.prepare("DELETE FROM dots WHERE id = ?").run(id);
    if (Number(result.changes) === 0) throw new ChatError("没有这个 Dot", 404);
  }

  private allocateId() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = `dot_${randomBytes(8).toString("hex")}`;
      if (!this.db.prepare("SELECT id FROM dots WHERE id = ?").get(id)) return id;
    }
    throw new ChatError("暂时无法分配 Dot 编号，请重试", 503);
  }
}

let singleton: DotStore | undefined;

export function getDotStore() {
  const directory = process.env.DATA_DIR || join(process.cwd(), "data");
  if (!singleton || singleton.directory !== directory) {
    singleton?.db.close();
    singleton = new DotStore(directory);
  }
  return singleton;
}

export function closeDotStore() {
  singleton?.db.close();
  singleton = undefined;
}
