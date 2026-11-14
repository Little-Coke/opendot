import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVIDENCE_LIMIT, GOAL_LIMIT, RUN_DURATION_MS, STEP_LIMIT } from "./work-profile";
import { closeWorkStore, getWorkStore, WorkStore } from "./work";

const valid = {
  goal: "整理本周会议纪要",
  criteria: ["纪要已写好", "已发给相关的人"],
  workspace: "个人",
  nextStep: "先列出要整理的会议",
};

describe("work store", () => {
  let directory = "";
  let extra = "";
  let store: WorkStore | undefined;

  afterEach(() => {
    try {
      store?.db.close();
    } catch {
      // 本例里可能已经关掉。
    }
    store = undefined;
    closeWorkStore();
    vi.unstubAllEnvs();
    if (directory) rmSync(directory, { recursive: true, force: true });
    if (extra) rmSync(extra, { recursive: true, force: true });
    directory = "";
    extra = "";
  });

  function open() {
    directory = mkdtempSync(join(tmpdir(), "opendot-work-"));
    store = new WorkStore(directory);
    return store;
  }

  it("keeps goals in their own database across restarts", () => {
    const current = open();
    const created = current.create({
      ...valid,
      goal: " 整理本周会议纪要 ",
      criteria: "纪要已写好\n\n已发给相关的人",
      status: "done",
      id: "goal_injected",
    });
    expect(created.id).toMatch(/^goal_[a-f0-9]{16}$/);
    expect(created.status).toBe("planned");
    expect(created.maxRuns).toBe(10);
    expect(created.id).not.toBe("goal_injected");
    current.db.close();
    chmodSync(directory, 0o755);
    chmodSync(join(directory, "work.sqlite"), 0o644);
    store = new WorkStore(directory);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(directory, "work.sqlite")).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "work.sqlite-wal")).mode & 0o777).toBe(0o600);
    expect(store.list()[0]).toMatchObject({
      goal: "整理本周会议纪要",
      criteria: ["纪要已写好", "已发给相关的人"],
      workspace: "个人",
      nextStep: "先列出要整理的会议",
      maxRuns: 10,
      status: "planned",
    });
    const names = readdirSync(directory);
    expect(names.some((name) => name.startsWith("work.sqlite"))).toBe(true);
    expect(names.some((name) => name.startsWith("opendot"))).toBe(false);
    expect(names.some((name) => name.startsWith("dots"))).toBe(false);
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));
    expect(tables).toContain("goals");
    expect(tables).not.toContain("turns");
    expect(tables).not.toContain("dots");
  });

  it("rejects out-of-range runs and stops at the goal limit without partial writes", () => {
    const current = open();
    expect(() => current.create({ ...valid, maxRuns: 0 })).toThrow(/1 到 10000/);
    expect(() => current.create({ ...valid, maxRuns: 10001 })).toThrow(/1 到 10000/);
    expect(() => current.create({ ...valid, maxRuns: 1.5 })).toThrow(/1 到 10000/);
    expect(current.list()).toEqual([]);
    expect(current.create({ ...valid, maxRuns: 1 }).maxRuns).toBe(1);
    expect(current.create({ ...valid, goal: "边界", maxRuns: 10000 }).maxRuns).toBe(10000);
    for (let index = current.list().length; index < GOAL_LIMIT; index += 1) {
      current.create({ ...valid, goal: `目标${index}` });
    }
    expect(() => current.create({ ...valid, goal: "多出来" })).toThrow(/200/);
    expect(current.list()).toHaveLength(GOAL_LIMIT);
    expect(current.list().some((goal) => goal.goal === "多出来")).toBe(false);
  });

  it("skips damaged rows and still lists the other filter states", () => {
    const current = open();
    const created = current.create(valid);
    const insert = current.db.prepare(
      `INSERT INTO goals(
        id, goal, criteria, workspace, next_step, max_runs, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(`goal_${"a".repeat(16)}`, "正在做", '["还在推进"]', "个人", "继续写", 4, "active", 30, 30);
    insert.run(`goal_${"b".repeat(16)}`, "等你确认", '["看过标题"]', "个人", "打开卡片", 2, "needs_you", 20, 20);
    insert.run(`goal_${"c".repeat(16)}`, "已经做完", '["有记录"]', "个人", "无", 2, "done", 10, 10);
    insert.run(`goal_${"d".repeat(16)}`, "坏数据", "not-json", "个人", "下一步", 10, "planned", 5, 5);
    insert.run(`goal_${"e".repeat(16)}`, "空条件", "[]", "个人", "下一步", 10, "planned", 4, 4);
    const goals = current.list();
    expect(goals.map((goal) => goal.status)).toEqual(["planned", "active", "needs_you", "done"]);
    expect(goals.some((goal) => goal.goal === "坏数据" || goal.goal === "空条件")).toBe(false);
    expect(current.get(created.id)?.criteria).toEqual(valid.criteria);
    expect(current.get(`goal_${"d".repeat(16)}`)).toBeUndefined();
    expect(current.get("xiaodian")).toBeUndefined();
  });

  it("follows the data directory used by the volume", () => {
    directory = mkdtempSync(join(tmpdir(), "opendot-work-a-"));
    extra = mkdtempSync(join(tmpdir(), "opendot-work-b-"));
    vi.stubEnv("DATA_DIR", directory);
    getWorkStore().create(valid);
    vi.stubEnv("DATA_DIR", extra);
    expect(getWorkStore().directory).toBe(extra);
    expect(getWorkStore().list()).toEqual([]);
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(compose).toContain("DATA_DIR: /data");
    expect(compose).toContain("opendot-data:/data");
  });

  it("moves one run through start, pause, resume and cancel without forking it", () => {
    const current = open();
    expect(() => current.create({ ...valid, requiresDevice: "yes" })).toThrow(/设备/);
    const goal = current.create(valid);
    expect(goal.requiresDevice).toBe(false);
    expect(goal.runsUsed).toBe(0);
    expect(goal.runStatus).toBeNull();
    expect(() => current.pause(goal.id)).toThrow(/不能暂停/);
    expect(() => current.resume(goal.id)).toThrow(/不能继续/);
    expect(() => current.cancel(goal.id)).toThrow(/没有可以取消/);
    expect(() => current.recordStep(goal.id)).toThrow(/先开始执行/);
    const started = current.start(goal.id);
    const runId = started.runs[0]?.id;
    expect(runId).toMatch(/^run_[a-f0-9]{16}$/);
    expect(started.runs[0]).toMatchObject({
      status: "running",
      steps: 0,
      maxSteps: STEP_LIMIT,
      maxDurationMs: RUN_DURATION_MS,
    });
    expect(started.goal).toMatchObject({ status: "active", runsUsed: 1, runStatus: "running" });
    expect(() => current.start(goal.id)).toThrow(/已有进行中的执行/);
    current.recordStep(goal.id);
    const paused = current.pause(goal.id);
    expect(paused.runs[0]).toMatchObject({ id: runId, status: "paused", steps: 1 });
    expect(paused.goal.runsUsed).toBe(1);
    expect(() => current.recordStep(goal.id)).toThrow(/继续后/);
    const resumed = current.resume(goal.id);
    expect(resumed.runs).toHaveLength(1);
    expect(resumed.runs[0]?.id).toBe(runId);
    expect(resumed.runs[0]?.status).toBe("running");
    expect(resumed.goal.runsUsed).toBe(1);
    const cancelled = current.cancel(goal.id);
    expect(cancelled.goal).toMatchObject({ status: "planned", runStatus: null, runsUsed: 1 });
    expect(cancelled.runs[0]).toMatchObject({ id: runId, status: "cancelled" });
    const again = current.start(goal.id);
    expect(again.goal.runsUsed).toBe(2);
    expect(again.runs[0]?.id).not.toBe(runId);
    expect(again.runs.map((run) => run.id)).toContain(runId);
  });

  it("consumes the execution budget on start and not when the same run resumes", () => {
    const current = open();
    const goal = current.create({ ...valid, maxRuns: 1 });
    const started = current.start(goal.id);
    const runId = started.runs[0]?.id;
    current.pause(goal.id);
    const resumed = current.resume(goal.id);
    expect(resumed.runs.map((run) => run.id)).toEqual([runId]);
    expect(resumed.goal.runsUsed).toBe(1);
    current.cancel(goal.id);
    expect(() => current.start(goal.id)).toThrow(/执行次数已用完/);
    const detail = current.detail(goal.id);
    expect(detail?.goal.status).toBe("planned");
    expect(detail?.runs).toHaveLength(1);
    expect(detail?.runs[0]?.id).toBe(runId);
  });

  it("refuses to finish without evidence, and requires device evidence when declared", () => {
    const current = open();
    const plain = current.create(valid);
    expect(() => current.complete(plain.id)).toThrow(/执行记录/);
    current.start(plain.id);
    expect(() => current.complete(plain.id)).toThrow(/还没有证据/);
    expect(() => current.apply(plain.id, { action: "evidence", kind: "note", note: "  " })).toThrow(/请填写证据/);
    expect(current.detail(plain.id)?.evidence).toEqual([]);
    expect(current.get(plain.id)?.status).toBe("active");
    current.pause(plain.id);
    current.addEvidence(plain.id, "note", " 纪要已写好 ");
    const finished = current.complete(plain.id);
    expect(finished.goal.status).toBe("done");
    expect(finished.evidence[0]).toMatchObject({ kind: "note", note: "纪要已写好" });
    expect(finished.runs[0]?.status).toBe("completed");
    expect(() => current.start(plain.id)).toThrow(/已经完成/);
    expect(() => current.addEvidence(plain.id, "note", "再写一条")).toThrow(/不能再补证据/);

    const deviceOnly = current.create({ ...valid, goal: "只看设备" });
    current.start(deviceOnly.id);
    current.addEvidence(deviceOnly.id, "device", "屏幕上有结果");
    expect(current.complete(deviceOnly.id).goal.status).toBe("done");

    const deviceGoal = current.create({ ...valid, goal: "导出照片", requiresDevice: true });
    expect(deviceGoal.requiresDevice).toBe(true);
    current.start(deviceGoal.id);
    current.addEvidence(deviceGoal.id, "note", "照片已导出");
    expect(() => current.complete(deviceGoal.id)).toThrow(/设备证据/);
    expect(current.get(deviceGoal.id)?.status).toBe("active");
    expect(current.detail(deviceGoal.id)?.runs[0]?.status).toBe("running");
    current.addEvidence(deviceGoal.id, "device", "从已配对的手机读取了相册");
    const done = current.complete(deviceGoal.id);
    expect(done.goal.status).toBe("done");
    expect(done.evidence.map((item) => item.kind)).toEqual(["note", "device"]);
  });

  it("stops a single run at 12 steps and at the default 30 minutes", () => {
    const current = open();
    const goal = current.create(valid);
    current.start(goal.id);
    for (let index = 0; index < STEP_LIMIT; index += 1) {
      expect(current.recordStep(goal.id).runs[0]?.steps).toBe(index + 1);
    }
    expect(() => current.recordStep(goal.id)).toThrow(/12 步/);
    expect(current.detail(goal.id)?.runs[0]?.steps).toBe(STEP_LIMIT);

    const expired = current.create({ ...valid, goal: "超时的委托" });
    const started = current.start(expired.id);
    current.db
      .prepare("UPDATE runs SET started_at = ? WHERE id = ?")
      .run(Date.now() - RUN_DURATION_MS, started.runs[0]?.id);
    expect(() => current.recordStep(expired.id)).toThrow(/30 分钟/);
    expect(current.detail(expired.id)?.runs[0]?.steps).toBe(0);

    const fresh = current.create({ ...valid, goal: "还在时限内" });
    const openRun = current.start(fresh.id);
    current.db
      .prepare("UPDATE runs SET started_at = ? WHERE id = ?")
      .run(Date.now() - RUN_DURATION_MS + 60_000, openRun.runs[0]?.id);
    expect(current.recordStep(fresh.id).runs[0]?.steps).toBe(1);
  });

  it("keeps the same run and its evidence after the store restarts", () => {
    const current = open();
    const created = current.create({ ...valid, requiresDevice: true });
    const started = current.start(created.id);
    current.pause(created.id);
    current.addEvidence(created.id, "device", "从手机读取了相册");
    const runId = started.runs[0]?.id;
    current.db.close();
    store = new WorkStore(directory);
    const detail = store.detail(created.id);
    expect(detail?.goal).toMatchObject({ runsUsed: 1, requiresDevice: true, runStatus: "paused" });
    expect(detail?.runs[0]?.id).toBe(runId);
    expect(detail?.evidence[0]).toMatchObject({ kind: "device", note: "从手机读取了相册", runId });
    const resumed = store.resume(created.id);
    expect(resumed.runs).toHaveLength(1);
    expect(resumed.runs[0]?.id).toBe(runId);
    expect(resumed.goal.runsUsed).toBe(1);
    const names = readdirSync(directory);
    expect(names.some((name) => name.startsWith("work.sqlite"))).toBe(true);
    expect(names.some((name) => name.startsWith("opendot"))).toBe(false);
    expect(names.some((name) => name.startsWith("dots"))).toBe(false);
    expect(names.some((name) => name.startsWith("memory"))).toBe(false);
    expect(names.some((name) => name.startsWith("channels"))).toBe(false);
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));
    expect(tables).toEqual(expect.arrayContaining(["goals", "runs", "evidence"]));
    expect(tables).not.toContain("turns");
    expect(tables).not.toContain("dots");
  });

  it("migrates an older work database without dropping the saved goal", () => {
    directory = mkdtempSync(join(tmpdir(), "opendot-work-old-"));
    const legacy = new DatabaseSync(join(directory, "work.sqlite"));
    legacy.exec(`
      CREATE TABLE goals (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        criteria TEXT NOT NULL,
        workspace TEXT NOT NULL,
        next_step TEXT NOT NULL,
        max_runs INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const id = `goal_${"f".repeat(16)}`;
    legacy
      .prepare(
        `INSERT INTO goals(
          id, goal, criteria, workspace, next_step, max_runs, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'planned', 1, 1)`,
      )
      .run(id, "整理本周会议纪要", '["纪要已写好"]', "个人", "先列出要整理的会议", 10);
    legacy.close();
    store = new WorkStore(directory);
    expect(store.get(id)).toMatchObject({
      goal: "整理本周会议纪要",
      requiresDevice: false,
      runsUsed: 0,
      runStatus: null,
      status: "planned",
    });
    const started = store.start(id);
    expect(started.goal.runsUsed).toBe(1);
    expect(started.runs[0]).toMatchObject({ maxSteps: STEP_LIMIT, maxDurationMs: RUN_DURATION_MS });
  });

  it("stops adding evidence once a goal reaches the evidence limit", () => {
    const current = open();
    const goal = current.create(valid);
    for (let index = 0; index < EVIDENCE_LIMIT; index += 1) {
      current.addEvidence(goal.id, "note", `证据${index}`);
    }
    expect(() => current.addEvidence(goal.id, "note", "多出来")).toThrow(new RegExp(String(EVIDENCE_LIMIT)));
    expect(current.detail(goal.id)?.evidence).toHaveLength(EVIDENCE_LIMIT);
    expect(current.detail(goal.id)?.evidence.some((item) => item.note === "多出来")).toBe(false);
  });
});
