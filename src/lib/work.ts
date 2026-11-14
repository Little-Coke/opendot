import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { ChatError } from "./chat-store";
import {
  EVIDENCE_LIMIT,
  GOAL_LIMIT,
  RUN_DURATION_MS,
  RUN_LIMIT_MAX,
  RUN_LIMIT_MIN,
  STEP_LIMIT,
  type EvidenceKind,
  type WorkDetail,
  type WorkEvidence,
  type WorkGoal,
  type WorkRun,
  isEvidenceId,
  isEvidenceKind,
  isRunId,
  isRunStatus,
  isWorkId,
  isWorkStatus,
  parseWorkAction,
  parseWorkInput,
} from "./work-profile";

const goalColumns = `id, goal, criteria, workspace, next_step AS nextStep,
  max_runs AS maxRuns, status, requires_device AS requiresDevice,
  created_at AS createdAt, updated_at AS updatedAt,
  (SELECT COUNT(*) FROM runs WHERE runs.goal_id = goals.id) AS runsUsed,
  (
    SELECT status FROM runs
    WHERE runs.goal_id = goals.id AND status IN ('running', 'paused')
    ORDER BY started_at DESC, rowid DESC
    LIMIT 1
  ) AS runStatus`;

const runColumns = `id, goal_id AS goalId, status, steps, max_steps AS maxSteps,
  max_duration_ms AS maxDurationMs, started_at AS startedAt, updated_at AS updatedAt`;

const evidenceColumns = `id, goal_id AS goalId, run_id AS runId, kind, note, created_at AS createdAt`;

type GoalRow = {
  id: string;
  goal: string;
  criteria: string;
  workspace: string;
  nextStep: string;
  maxRuns: number;
  runsUsed: number;
  requiresDevice: number;
  status: string;
  runStatus: string | null;
  createdAt: number;
  updatedAt: number;
};

type RunRow = {
  id: string;
  goalId: string;
  status: string;
  steps: number;
  maxSteps: number;
  maxDurationMs: number;
  startedAt: number;
  updatedAt: number;
};

type EvidenceRow = {
  id: string;
  goalId: string;
  runId: string | null;
  kind: string;
  note: string;
  createdAt: number;
};

function rollback(db: DatabaseSync) {
  try {
    db.exec("ROLLBACK");
  } catch {
    // 事务可能尚未开始。
  }
}

function ensureColumn(db: DatabaseSync, table: string, name: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (rows.some((row) => row.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

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

function mapGoal(row: GoalRow): WorkGoal | undefined {
  if (!isWorkId(row.id) || !isWorkStatus(row.status)) return undefined;
  const criteria = readStoredCriteria(row.criteria);
  const maxRuns = Number(row.maxRuns);
  const runsUsed = Number(row.runsUsed);
  const requiresDevice = Number(row.requiresDevice);
  if (
    !criteria ||
    !row.goal.trim() ||
    !row.workspace.trim() ||
    !row.nextStep.trim() ||
    !Number.isSafeInteger(maxRuns) ||
    maxRuns < RUN_LIMIT_MIN ||
    maxRuns > RUN_LIMIT_MAX ||
    !Number.isSafeInteger(runsUsed) ||
    runsUsed < 0 ||
    (requiresDevice !== 0 && requiresDevice !== 1)
  ) {
    return undefined;
  }
  const runStatus = row.runStatus === "running" || row.runStatus === "paused" ? row.runStatus : null;
  return {
    id: row.id,
    goal: row.goal,
    criteria,
    workspace: row.workspace,
    nextStep: row.nextStep,
    maxRuns,
    runsUsed,
    requiresDevice: requiresDevice === 1,
    status: row.status,
    runStatus,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function mapRun(row: RunRow): WorkRun | undefined {
  const steps = Number(row.steps);
  const maxSteps = Number(row.maxSteps);
  const maxDurationMs = Number(row.maxDurationMs);
  if (
    !isRunId(row.id) ||
    !isWorkId(row.goalId) ||
    !isRunStatus(row.status) ||
    !Number.isSafeInteger(steps) ||
    steps < 0 ||
    steps > STEP_LIMIT ||
    maxSteps !== STEP_LIMIT ||
    maxDurationMs !== RUN_DURATION_MS
  ) {
    return undefined;
  }
  return {
    id: row.id,
    goalId: row.goalId,
    status: row.status,
    steps,
    maxSteps,
    maxDurationMs,
    startedAt: Number(row.startedAt),
    updatedAt: Number(row.updatedAt),
  };
}

function mapEvidence(row: EvidenceRow): WorkEvidence | undefined {
  if (!isEvidenceId(row.id) || !isWorkId(row.goalId) || !isEvidenceKind(row.kind)) return undefined;
  if (row.runId !== null && !isRunId(row.runId)) return undefined;
  const note = row.note.trim();
  if (!note) return undefined;
  return {
    id: row.id,
    goalId: row.goalId,
    runId: row.runId,
    kind: row.kind,
    note,
    createdAt: Number(row.createdAt),
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
        requires_device INTEGER NOT NULL DEFAULT 0 CHECK(requires_device IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    ensureColumn(
      this.db,
      "goals",
      "requires_device",
      "requires_device INTEGER NOT NULL DEFAULT 0 CHECK(requires_device IN (0, 1))",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'paused', 'cancelled', 'completed')),
        steps INTEGER NOT NULL DEFAULT 0 CHECK(steps BETWEEN 0 AND ${STEP_LIMIT}),
        max_steps INTEGER NOT NULL DEFAULT ${STEP_LIMIT} CHECK(max_steps = ${STEP_LIMIT}),
        max_duration_ms INTEGER NOT NULL DEFAULT ${RUN_DURATION_MS} CHECK(max_duration_ms = ${RUN_DURATION_MS}),
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        run_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('note', 'device')),
        note TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_goal ON runs(goal_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS evidence_goal ON evidence(goal_id, created_at);
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
      .prepare(`SELECT ${goalColumns} FROM goals ORDER BY created_at DESC, rowid DESC`)
      .all() as GoalRow[];
    return rows.flatMap((row) => {
      const goal = mapGoal(row);
      return goal ? [goal] : [];
    });
  }

  get(id: string): WorkGoal | undefined {
    if (!isWorkId(id)) return undefined;
    const row = this.db.prepare(`SELECT ${goalColumns} FROM goals WHERE id = ?`).get(id) as
      | GoalRow
      | undefined;
    return row ? mapGoal(row) : undefined;
  }

  detail(id: string): WorkDetail | undefined {
    const goal = this.get(id);
    if (!goal) return undefined;
    return { goal, runs: this.runsFor(id), evidence: this.evidenceFor(id) };
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
      id = this.allocateGoalId();
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO goals(
            id, goal, criteria, workspace, next_step, max_runs, requires_device, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`,
        )
        .run(
          id,
          parsed.value.goal,
          JSON.stringify(parsed.value.criteria),
          parsed.value.workspace,
          parsed.value.nextStep,
          parsed.value.maxRuns,
          parsed.value.requiresDevice ? 1 : 0,
          now,
          now,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      rollback(this.db);
      throw error;
    }
    const created = this.get(id);
    if (!created) throw new ChatError("目标已写入但无法读取", 500);
    return created;
  }

  apply(id: string, input: unknown): WorkDetail {
    const parsed = parseWorkAction(input);
    if (!parsed.ok) throw new ChatError(parsed.error);
    switch (parsed.value.action) {
      case "start":
        return this.start(id);
      case "pause":
        return this.pause(id);
      case "resume":
        return this.resume(id);
      case "cancel":
        return this.cancel(id);
      case "step":
        return this.recordStep(id);
      case "complete":
        return this.complete(id);
      case "evidence":
        return this.addEvidence(id, parsed.value.kind, parsed.value.note);
    }
  }

  start(id: string): WorkDetail {
    return this.transaction(() => {
      const goal = this.requireGoal(id);
      if (goal.status === "done") throw new ChatError("这个委托已经完成");
      if (this.openRun(id)) throw new ChatError("已有进行中的执行，请先暂停、继续或取消");
      if (goal.runsUsed >= goal.maxRuns) {
        throw new ChatError(`执行次数已用完，最多 ${goal.maxRuns} 次`);
      }
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO runs(
            id, goal_id, status, steps, max_steps, max_duration_ms, started_at, updated_at
          ) VALUES (?, ?, 'running', 0, ?, ?, ?, ?)`,
        )
        .run(this.allocateRunId(), id, STEP_LIMIT, RUN_DURATION_MS, now, now);
      this.db.prepare("UPDATE goals SET status = 'active', updated_at = ? WHERE id = ?").run(now, id);
      return this.requireDetail(id);
    });
  }

  pause(id: string): WorkDetail {
    return this.transaction(() => {
      const goal = this.requireGoal(id);
      if (goal.status === "done") throw new ChatError("这个委托已经完成");
      const open = this.openRun(id);
      if (!open || open.status !== "running") {
        throw new ChatError("现在没有正在执行的记录，不能暂停");
      }
      const now = Date.now();
      const updated = this.db
        .prepare("UPDATE runs SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'running'")
        .run(now, open.id);
      if (Number(updated.changes) !== 1) throw new ChatError("现在没有正在执行的记录，不能暂停");
      this.db.prepare("UPDATE goals SET updated_at = ? WHERE id = ?").run(now, id);
      return this.requireDetail(id);
    });
  }

  resume(id: string): WorkDetail {
    return this.transaction(() => {
      const goal = this.requireGoal(id);
      if (goal.status === "done") throw new ChatError("这个委托已经完成");
      const open = this.openRun(id);
      if (!open || open.status !== "paused") {
        throw new ChatError("现在没有暂停的执行，不能继续");
      }
      const now = Date.now();
      const updated = this.db
        .prepare("UPDATE runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'paused'")
        .run(now, open.id);
      if (Number(updated.changes) !== 1) throw new ChatError("现在没有暂停的执行，不能继续");
      this.db
        .prepare("UPDATE goals SET status = 'active', updated_at = ? WHERE id = ?")
        .run(now, id);
      return this.requireDetail(id);
    });
  }

  cancel(id: string): WorkDetail {
    return this.transaction(() => {
      const goal = this.requireGoal(id);
      if (goal.status === "done") throw new ChatError("这个委托已经完成");
      const open = this.openRun(id);
      if (!open) throw new ChatError("现在没有可以取消的执行");
      const now = Date.now();
      const updated = this.db
        .prepare(
          `UPDATE runs SET status = 'cancelled', updated_at = ?
           WHERE id = ? AND status IN ('running', 'paused')`,
        )
        .run(now, open.id);
      if (Number(updated.changes) !== 1) throw new ChatError("现在没有可以取消的执行");
      this.db
        .prepare("UPDATE goals SET status = 'planned', updated_at = ? WHERE id = ? AND status != 'done'")
        .run(now, id);
      return this.requireDetail(id);
    });
  }

  recordStep(id: string): WorkDetail {
    return this.transaction(() => {
      const goal = this.requireGoal(id);
      if (goal.status === "done") throw new ChatError("这个委托已经完成");
      const open = this.openRun(id);
      if (!open) throw new ChatError("请先开始执行，再记录步骤");
      if (open.status !== "running") throw new ChatError("执行已暂停，继续后才能记录步骤");
      if (open.steps >= STEP_LIMIT) throw new ChatError(`单次运行最多 ${STEP_LIMIT} 步`);
      const now = Date.now();
      if (now - open.startedAt >= open.maxDurationMs) {
        throw new ChatError("这次执行已超过 30 分钟，不能再记步骤");
      }
      const updated = this.db
        .prepare(
          `UPDATE runs SET steps = steps + 1, updated_at = ?
           WHERE id = ? AND status = 'running' AND steps < ?`,
        )
        .run(now, open.id, STEP_LIMIT);
      if (Number(updated.changes) !== 1) throw new ChatError(`单次运行最多 ${STEP_LIMIT} 步`);
      this.db.prepare("UPDATE goals SET updated_at = ? WHERE id = ?").run(now, id);
      return this.requireDetail(id);
    });
  }

  addEvidence(id: string, kind: EvidenceKind, note: string): WorkDetail {
    const parsed = parseWorkAction({ action: "evidence", kind, note });
    if (!parsed.ok || parsed.value.action !== "evidence") {
      throw new ChatError(parsed.ok ? "证据类型不正确" : parsed.error);
    }
    const evidence = parsed.value;
    return this.transaction(() => {
      const goal = this.requireGoal(id);
      if (goal.status === "done") throw new ChatError("这个委托已经完成，不能再补证据");
      const count = this.db.prepare("SELECT COUNT(*) AS count FROM evidence WHERE goal_id = ?").get(id) as {
        count: number;
      };
      if (Number(count.count) >= EVIDENCE_LIMIT) {
        throw new ChatError(`一条委托最多保存 ${EVIDENCE_LIMIT} 条证据`);
      }
      const now = Date.now();
      const open = this.openRun(id);
      this.db
        .prepare(
          `INSERT INTO evidence(id, goal_id, run_id, kind, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(this.allocateEvidenceId(), id, open?.id ?? null, evidence.kind, evidence.note, now);
      this.db.prepare("UPDATE goals SET updated_at = ? WHERE id = ?").run(now, id);
      return this.requireDetail(id);
    });
  }

  complete(id: string): WorkDetail {
    return this.transaction(() => {
      const goal = this.requireGoal(id);
      if (goal.status === "done") throw new ChatError("这个委托已经完成");
      if (this.runsFor(id).length === 0) throw new ChatError("还没有执行记录，不能标记完成");
      const evidence = this.evidenceFor(id);
      if (evidence.length === 0) throw new ChatError("还没有证据，不能标记完成");
      if (goal.requiresDevice && !evidence.some((item) => item.kind === "device")) {
        throw new ChatError("这个委托需要设备，还要提供设备证据才能标记完成");
      }
      const now = Date.now();
      const open = this.openRun(id);
      if (open) {
        this.db
          .prepare(
            `UPDATE runs SET status = 'completed', updated_at = ?
             WHERE id = ? AND status IN ('running', 'paused')`,
          )
          .run(now, open.id);
      }
      const updated = this.db
        .prepare("UPDATE goals SET status = 'done', updated_at = ? WHERE id = ? AND status != 'done'")
        .run(now, id);
      if (Number(updated.changes) !== 1) throw new ChatError("这个委托已经完成");
      return this.requireDetail(id);
    });
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      rollback(this.db);
      throw error;
    }
  }

  private requireGoal(id: string) {
    const goal = this.get(id);
    if (!goal) throw new ChatError("找不到这个委托", 404);
    return goal;
  }

  private requireDetail(id: string) {
    const detail = this.detail(id);
    if (!detail) throw new ChatError("找不到这个委托", 404);
    return detail;
  }

  private openRun(goalId: string) {
    return this.runsFor(goalId).find((run) => run.status === "running" || run.status === "paused");
  }

  private runsFor(goalId: string) {
    const rows = this.db
      .prepare(`SELECT ${runColumns} FROM runs WHERE goal_id = ? ORDER BY started_at DESC, rowid DESC`)
      .all(goalId) as RunRow[];
    return rows.flatMap((row) => {
      const run = mapRun(row);
      return run ? [run] : [];
    });
  }

  private evidenceFor(goalId: string) {
    const rows = this.db
      .prepare(`SELECT ${evidenceColumns} FROM evidence WHERE goal_id = ? ORDER BY created_at ASC, rowid ASC`)
      .all(goalId) as EvidenceRow[];
    return rows.flatMap((row) => {
      const item = mapEvidence(row);
      return item ? [item] : [];
    });
  }

  private allocateGoalId() {
    return this.allocateId("goal", "goals", "暂时无法分配目标编号，请重试");
  }

  private allocateRunId() {
    return this.allocateId("run", "runs", "暂时无法分配执行编号，请重试");
  }

  private allocateEvidenceId() {
    return this.allocateId("ev", "evidence", "暂时无法分配证据编号，请重试");
  }

  private allocateId(prefix: "goal" | "run" | "ev", table: "goals" | "runs" | "evidence", failure: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = `${prefix}_${randomBytes(8).toString("hex")}`;
      if (!this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) return id;
    }
    throw new ChatError(failure, 503);
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
