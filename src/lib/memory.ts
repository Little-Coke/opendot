import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { ChatError } from "./chat-store";
import {
  MEMORY_LIMIT,
  VERSION_LIMIT,
  isMemoryId,
  isMemoryKind,
  isMemoryScope,
  parseMemoryAction,
  parseMemoryDraft,
  parseMemoryListQuery,
  type MemoryContent,
  type MemoryDraft,
  type MemoryItem,
  type MemoryListQuery,
  type MemoryVersion,
} from "./memory-profile";

const memoryColumns = `id, kind, scope, workspace, title, body, version,
  cross_workspace AS crossWorkspace, created_at AS createdAt, updated_at AS updatedAt`;

type MemoryRow = {
  id: string;
  kind: string;
  scope: string;
  workspace: string;
  title: string;
  body: string;
  version: number;
  crossWorkspace: number;
  createdAt: number;
  updatedAt: number;
};

type VersionRow = {
  version: number;
  kind: string;
  title: string;
  body: string;
  createdAt: number;
};

export type MemoryList = {
  mem0Enabled: boolean;
  memories: MemoryItem[];
};

export type MemoryDetail = {
  mem0Enabled: boolean;
  memory: MemoryItem;
  versions: MemoryVersion[];
};

export type MemoryWriteBody = {
  mem0Enabled: boolean;
  memory?: MemoryItem;
  versions?: MemoryVersion[];
  forgotten?: boolean;
};

function rollback(db: DatabaseSync) {
  try {
    db.exec("ROLLBACK");
  } catch {
    // 事务可能尚未开始。
  }
}

function mapContent(row: { kind: string; title: string; body: string }): MemoryContent | undefined {
  if (!isMemoryKind(row.kind) || !row.title.trim() || !row.body.trim()) return undefined;
  return { kind: row.kind, title: row.title, body: row.body };
}

function mapMemory(row: MemoryRow): MemoryItem | undefined {
  const content = mapContent(row);
  if (!content || !isMemoryId(row.id) || !isMemoryScope(row.scope)) return undefined;
  const version = Number(row.version);
  const crossWorkspace = Number(row.crossWorkspace);
  if (!Number.isSafeInteger(version) || version < 1) return undefined;
  if (crossWorkspace !== 0 && crossWorkspace !== 1) return undefined;
  if (row.scope === "personal") {
    if (row.workspace !== "") return undefined;
  } else if (!row.workspace.trim() || crossWorkspace !== 0) {
    return undefined;
  }
  return {
    ...content,
    id: row.id,
    scope: row.scope,
    workspace: row.workspace,
    version,
    crossWorkspace: crossWorkspace === 1,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function mapVersion(row: VersionRow): MemoryVersion | undefined {
  const content = mapContent(row);
  const version = Number(row.version);
  if (!content || !Number.isSafeInteger(version) || version < 1) return undefined;
  return { ...content, version, createdAt: Number(row.createdAt) };
}

function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** 记忆存在数据卷的 memory.sqlite，不写入聊天库、dots.sqlite、work.sqlite 或 channels.sqlite。 */
export class MemoryStore {
  readonly db: DatabaseSync;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const databasePath = join(directory, "memory.sqlite");
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS memory_prefs (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        mem0_enabled INTEGER NOT NULL DEFAULT 0 CHECK(mem0_enabled IN (0, 1))
      );
      INSERT OR IGNORE INTO memory_prefs(id, mem0_enabled) VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('fact', 'decision', 'experience', 'follow_up')),
        scope TEXT NOT NULL CHECK(scope IN ('workspace', 'personal')),
        workspace TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        cross_workspace INTEGER NOT NULL DEFAULT 0 CHECK(cross_workspace IN (0, 1)),
        forgotten INTEGER NOT NULL DEFAULT 0 CHECK(forgotten IN (0, 1)),
        version INTEGER NOT NULL CHECK(version >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (
          (scope = 'personal' AND workspace = '' )
          OR (scope = 'workspace' AND length(trim(workspace)) > 0 AND cross_workspace = 0)
        )
      );
      CREATE TABLE IF NOT EXISTS memory_versions (
        memory_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version >= 1),
        kind TEXT NOT NULL CHECK(kind IN ('fact', 'decision', 'experience', 'follow_up')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (memory_id, version)
      );
      CREATE INDEX IF NOT EXISTS memories_active ON memories(forgotten, updated_at);
    `);
    for (const suffix of ["-wal", "-shm"]) {
      try {
        chmodSync(`${databasePath}${suffix}`, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  mem0Enabled() {
    const row = this.db
      .prepare("SELECT mem0_enabled AS enabled FROM memory_prefs WHERE id = 1")
      .get() as { enabled: number } | undefined;
    return row?.enabled === 1;
  }

  /** 只改本机开关，不连接 Mem0。 */
  setMem0(enabled: boolean) {
    if (typeof enabled !== "boolean") throw new ChatError("请明确 Mem0 开关");
    this.db.prepare("UPDATE memory_prefs SET mem0_enabled = ? WHERE id = 1").run(enabled ? 1 : 0);
    return this.mem0Enabled();
  }

  list(query: MemoryListQuery): MemoryItem[] {
    const pattern = likePattern(query.q);
    const rows = this.db
      .prepare(
        `SELECT ${memoryColumns} FROM memories
         WHERE forgotten = 0
           AND (? = '' OR title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
           AND (? = '' OR kind = ?)
           AND (? = '' OR scope = ?)
           AND (
             ? = ''
             OR (scope = 'workspace' AND workspace = ?)
             OR (scope = 'personal' AND cross_workspace = 1)
           )
         ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(
        query.q,
        pattern,
        pattern,
        query.kind,
        query.kind,
        query.scope,
        query.scope,
        query.forWorkspace,
        query.forWorkspace,
      ) as MemoryRow[];
    return rows.flatMap((row) => {
      const memory = mapMemory(row);
      return memory ? [memory] : [];
    });
  }

  detail(id: string): { memory: MemoryItem; versions: MemoryVersion[] } {
    const memory = this.readActive(id);
    if (!memory) throw new ChatError("找不到这条记忆", 404);
    const rows = this.db
      .prepare(
        `SELECT version, kind, title, body, created_at AS createdAt
         FROM memory_versions WHERE memory_id = ? ORDER BY version DESC`,
      )
      .all(id) as VersionRow[];
    const versions = rows.flatMap((row) => {
      const version = mapVersion(row);
      return version ? [version] : [];
    });
    if (!versions.some((version) => version.version === memory.version)) {
      throw new ChatError("记忆版本无法读取", 500);
    }
    return { memory, versions };
  }

  create(input: unknown): MemoryItem {
    const parsed = parseMemoryDraft(input);
    if (!parsed.ok) throw new ChatError(parsed.error);
    return this.insert(parsed.value);
  }

  revise(input: unknown): { memory: MemoryItem; versions: MemoryVersion[] } {
    const parsed = parseMemoryAction(input);
    if (!parsed.ok) throw new ChatError(parsed.error);
    if (parsed.value.action !== "revise") throw new ChatError("请说明要做的操作");
    const { id, content } = parsed.value;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readActive(id);
      if (!current) throw new ChatError("找不到这条记忆", 404);
      if (
        current.kind === content.kind &&
        current.title === content.title &&
        current.body === content.body
      ) {
        throw new ChatError("内容没有变化，不会生成新版本");
      }
      if (current.version >= VERSION_LIMIT) {
        throw new ChatError(`这条记忆最多保留 ${VERSION_LIMIT} 个版本`);
      }
      const now = Date.now();
      const next = current.version + 1;
      this.db
        .prepare(
          `UPDATE memories
           SET kind = ?, title = ?, body = ?, version = ?, updated_at = ?
           WHERE id = ? AND forgotten = 0 AND version = ?`,
        )
        .run(content.kind, content.title, content.body, next, now, id, current.version);
      this.insertVersion(id, next, content, now);
      this.db.exec("COMMIT");
    } catch (error) {
      rollback(this.db);
      throw error;
    }
    return this.detail(id);
  }

  forget(id: string) {
    if (!isMemoryId(id)) throw new ChatError("找不到这条记忆", 404);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.db
        .prepare(
          "UPDATE memories SET forgotten = 1, updated_at = ? WHERE id = ? AND forgotten = 0",
        )
        .run(Date.now(), id);
      if (Number(updated.changes) !== 1) throw new ChatError("找不到这条记忆", 404);
      this.db.exec("COMMIT");
    } catch (error) {
      rollback(this.db);
      throw error;
    }
  }

  authorize(id: string, crossWorkspace: boolean): MemoryItem {
    if (!isMemoryId(id)) throw new ChatError("找不到这条记忆", 404);
    if (typeof crossWorkspace !== "boolean") throw new ChatError("请明确是否允许跨工作区使用");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT scope, forgotten FROM memories WHERE id = ?")
        .get(id) as { scope: string; forgotten: number } | undefined;
      if (!row || row.forgotten === 1) throw new ChatError("找不到这条记忆", 404);
      if (row.scope !== "personal") throw new ChatError("只有个人记忆可以逐条授权跨工作区使用");
      this.db
        .prepare(
          "UPDATE memories SET cross_workspace = ?, updated_at = ? WHERE id = ? AND forgotten = 0",
        )
        .run(crossWorkspace ? 1 : 0, Date.now(), id);
      this.db.exec("COMMIT");
    } catch (error) {
      rollback(this.db);
      throw error;
    }
    const memory = this.readActive(id);
    if (!memory) throw new ChatError("找不到这条记忆", 404);
    return memory;
  }

  private insert(draft: MemoryDraft) {
    let id = "";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT COUNT(*) AS count FROM memories WHERE forgotten = 0")
        .get() as { count: number };
      if (Number(row.count) >= MEMORY_LIMIT) {
        throw new ChatError(`最多保存 ${MEMORY_LIMIT} 条记忆。忘记后可以再记。`);
      }
      id = this.allocateId();
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO memories(
            id, kind, scope, workspace, title, body, cross_workspace, forgotten, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)`,
        )
        .run(id, draft.kind, draft.scope, draft.workspace, draft.title, draft.body, now, now);
      this.insertVersion(id, 1, draft, now);
      this.db.exec("COMMIT");
    } catch (error) {
      rollback(this.db);
      throw error;
    }
    const created = this.readActive(id);
    if (!created) throw new ChatError("记忆已写入但无法读取", 500);
    return created;
  }

  private insertVersion(id: string, version: number, content: MemoryContent, createdAt: number) {
    this.db
      .prepare(
        `INSERT INTO memory_versions(memory_id, version, kind, title, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, version, content.kind, content.title, content.body, createdAt);
  }

  private readActive(id: string) {
    if (!isMemoryId(id)) return undefined;
    const row = this.db
      .prepare(`SELECT ${memoryColumns} FROM memories WHERE id = ? AND forgotten = 0`)
      .get(id) as MemoryRow | undefined;
    return row ? mapMemory(row) : undefined;
  }

  private allocateId() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = `mem_${randomBytes(8).toString("hex")}`;
      if (!this.db.prepare("SELECT id FROM memories WHERE id = ?").get(id)) return id;
    }
    throw new ChatError("暂时无法分配记忆编号，请重试", 503);
  }
}

let singleton: MemoryStore | undefined;

export function getMemoryStore() {
  const directory = process.env.DATA_DIR || join(process.cwd(), "data");
  if (!singleton || singleton.directory !== directory) {
    singleton?.db.close();
    singleton = new MemoryStore(directory);
  }
  return singleton;
}

export function closeMemoryStore() {
  singleton?.db.close();
  singleton = undefined;
}

export function viewMemory(url: URL, store = getMemoryStore()): MemoryList | MemoryDetail {
  const parsed = parseMemoryListQuery(url.searchParams);
  if (!parsed.ok) throw new ChatError(parsed.error);
  const mem0Enabled = store.mem0Enabled();
  const id = url.searchParams.get("id");
  if (id) {
    const detail = store.detail(id);
    return { mem0Enabled, ...detail };
  }
  return { mem0Enabled, memories: store.list(parsed.value) };
}

export function changeMemory(
  input: unknown,
  store = getMemoryStore(),
): { status: number; body: MemoryWriteBody } {
  const parsed = parseMemoryAction(input);
  if (!parsed.ok) throw new ChatError(parsed.error);
  switch (parsed.value.action) {
    case "create":
      return {
        status: 201,
        body: { mem0Enabled: store.mem0Enabled(), memory: store.create(parsed.value.draft) },
      };
    case "revise": {
      const revised = store.revise(input);
      return { status: 200, body: { mem0Enabled: store.mem0Enabled(), ...revised } };
    }
    case "forget":
      store.forget(parsed.value.id);
      return { status: 200, body: { mem0Enabled: store.mem0Enabled(), forgotten: true } };
    case "authorize":
      return {
        status: 200,
        body: {
          mem0Enabled: store.mem0Enabled(),
          memory: store.authorize(parsed.value.id, parsed.value.crossWorkspace),
        },
      };
    case "mem0":
      return { status: 200, body: { mem0Enabled: store.setMem0(parsed.value.enabled) } };
    default:
      throw new ChatError("请说明要做的操作");
  }
}
