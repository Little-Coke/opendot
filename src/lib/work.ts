import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { ChatError } from "./chat-store";
import {
  GOAL_LIMIT,
  RUN_LIMIT_MAX,
  RUN_LIMIT_MIN,
  type WorkGoal,
  isWorkId,
  isWorkStatus,
  parseWorkInput,
} from "./work-profile";

const columns = `id, goal, criteria, workspace, next_step AS nextStep,
  max_runs AS maxRuns, status, created_at AS createdAt, updated_at AS updatedAt`;

type Row = {
  id: string;
  goal: string;
  criteria: string;
  workspace: string;
  nextStep: string;
  maxRuns: number;
  status: string;
  createdAt: number;
  updatedAt: number;
};

function readStoredCriteria(value: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const criteria: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") return undefined;
    const text = item.trim();
    if (!text) return undefined;
    criteria.push(text);
  }
  return criteria;
}

function mapRow(row: Row): WorkGoal | undefined {
  if (!isWorkId(row.id) || !isWorkStatus(row.status)) return undefined;
  const criteria = readStoredCriteria(row.criteria);
  const maxRuns = Number(row.maxRuns);
  if (
    !criteria ||
    !row.goal.trim() ||
    !row.workspace.trim() ||
    !row.nextStep.trim() ||
    !Number.isSafeInteger(maxRuns) ||
    maxRuns < RUN_LIMIT_MIN ||
    maxRuns > RUN_LIMIT_MAX
  ) {
    return undefined;
  }
  return {
    id: row.id,
    goal: row.goal,
    criteria,
    workspace: row.workspace,
    nextStep: row.nextStep,
    maxRuns,
    status: row.status,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

/** 委托存在数据卷的 work.sqlite，不写入聊天库或 dots.sqlite。 */
export class WorkStore {
  readonly db: DatabaseSync;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const databasePath = join(directory, "work.sqlite");
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        criteria TEXT NOT NULL,
        workspace TEXT NOT NULL,
        next_step TEXT NOT NULL,
        max_runs INTEGER NOT NULL CHECK(max_runs BETWEEN ${RUN_LIMIT_MIN} AND ${RUN_LIMIT_MAX}),
        status TEXT NOT NULL CHECK(status IN ('active', 'needs_you', 'done', 'planned')),
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

  list(): WorkGoal[] {
    const rows = this.db
      .prepare(`SELECT ${columns} FROM goals ORDER BY created_at DESC, rowid DESC`)
      .all() as Row[];
    return rows.flatMap((row) => {
      const goal = mapRow(row);
      return goal ? [goal] : [];
    });
  }

  get(id: string): WorkGoal | undefined {
    if (!isWorkId(id)) return undefined;
    const row = this.db.prepare(`SELECT ${columns} FROM goals WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  create(input: unknown): WorkGoal {
    const parsed = parseWorkInput(input);
    if (!parsed.ok) throw new ChatError(parsed.error);
    let id = "";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT COUNT(*) AS count FROM goals").get() as {
        count: number;
      };
      if (Number(row.count) >= GOAL_LIMIT) {
        throw new ChatError(`最多保存 ${GOAL_LIMIT} 个目标`);
      }
      id = this.allocateId();
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO goals(
            id, goal, criteria, workspace, next_step, max_runs, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?)`,
        )
        .run(
          id,
          parsed.value.goal,
          JSON.stringify(parsed.value.criteria),
          parsed.value.workspace,
          parsed.value.nextStep,
          parsed.value.maxRuns,
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
    if (!created) throw new ChatError("目标已写入但无法读取", 500);
    return created;
  }

  private allocateId() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = `goal_${randomBytes(8).toString("hex")}`;
      if (!this.db.prepare("SELECT id FROM goals WHERE id = ?").get(id)) return id;
    }
    throw new ChatError("暂时无法分配目标编号，请重试", 503);
  }
}

let singleton: WorkStore | undefined;

export function getWorkStore() {
  const directory = process.env.DATA_DIR || join(process.cwd(), "data");
  if (!singleton || singleton.directory !== directory) {
    singleton?.db.close();
    singleton = new WorkStore(directory);
  }
  return singleton;
}

export function closeWorkStore() {
  singleton?.db.close();
  singleton = undefined;
}
