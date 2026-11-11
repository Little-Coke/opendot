import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GOAL_LIMIT } from "./work-profile";
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
});
