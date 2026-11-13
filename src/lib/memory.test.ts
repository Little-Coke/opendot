import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatStore } from "./chat-store";
import { MEMORY_LIMIT, VERSION_LIMIT, type MemoryListQuery } from "./memory-profile";
import { MemoryStore, closeMemoryStore, getMemoryStore } from "./memory";

const all: MemoryListQuery = { q: "", kind: "", scope: "", forWorkspace: "" };
const chatText = "这条聊天必须留下来-第10天";

const fact = {
  kind: "fact",
  scope: "workspace",
  workspace: "产品",
  title: "周五例会",
  body: "改到下午三点",
};

describe("memory store", () => {
  let directory = "";
  let extra = "";
  let store: MemoryStore | undefined;

  afterEach(() => {
    try {
      store?.db.close();
    } catch {
      // 本例里可能已经关掉。
    }
    store = undefined;
    closeMemoryStore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (directory) rmSync(directory, { recursive: true, force: true });
    if (extra) rmSync(extra, { recursive: true, force: true });
    directory = "";
    extra = "";
  });

  function open() {
    directory = mkdtempSync(join(tmpdir(), "opendot-memory-"));
    store = new MemoryStore(directory);
    return store;
  }

  function contains(prefix: string, needle: string) {
    return readdirSync(directory)
      .filter((name) => name.startsWith(prefix))
      .map((name) => readFileSync(join(directory, name)))
      .some((file) => file.includes(Buffer.from(needle)));
  }

  it("stores memories in memory.sqlite and leaves Mem0 off", () => {
    const current = open();
    chmodSync(directory, 0o755);
    chmodSync(join(directory, "memory.sqlite"), 0o644);
    current.db.close();
    store = new MemoryStore(directory);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(directory, "memory.sqlite")).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "memory.sqlite-wal")).mode & 0o777).toBe(0o600);
    expect(store.mem0Enabled()).toBe(false);
    const created = [
      store.create(fact),
      store.create({ kind: "decision", scope: "workspace", workspace: "产品", title: "采用 SQLite", body: "记忆单独放一个库" }),
      store.create({ kind: "experience", scope: "personal", title: "先跑测试", body: "部署前要跑测试" }),
      store.create({ kind: "follow_up", scope: "workspace", workspace: "产品", title: "提醒小李", body: "请小李看纪要" }),
    ];
    expect(created.map((item) => item.kind)).toEqual(["fact", "decision", "experience", "follow_up"]);
    expect(created.every((item) => item.version === 1 && item.crossWorkspace === false)).toBe(true);
    expect(created[2].workspace).toBe("");
    const names = readdirSync(directory);
    expect(names.some((name) => name.startsWith("memory.sqlite"))).toBe(true);
    expect(names.some((name) => name.startsWith("opendot"))).toBe(false);
    expect(names.some((name) => name.startsWith("dots"))).toBe(false);
    expect(names.some((name) => name.startsWith("work"))).toBe(false);
    expect(names.some((name) => name.startsWith("channels"))).toBe(false);
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));
    expect(tables).toContain("memories");
    expect(tables).toContain("memory_versions");
    expect(tables).toContain("memory_prefs");
    expect(tables).not.toContain("turns");
    expect(tables).not.toContain("dots");
    expect(tables).not.toContain("goals");
    expect(tables).not.toContain("channels");
  });

  it("searches current text and treats percent as a literal", () => {
    const current = open();
    current.create({ ...fact, title: "100% 完成", body: "进度已经满了" });
    current.create({ kind: "decision", scope: "workspace", workspace: "产品", title: "普通决定", body: "继续用本地库" });
    const byText = current.list({ ...all, q: "纪要" });
    expect(byText).toEqual([]);
    current.create({ kind: "follow_up", scope: "workspace", workspace: "产品", title: "看纪要", body: "提醒小李" });
    expect(current.list({ ...all, q: "纪要" }).map((item) => item.title)).toEqual(["看纪要"]);
    expect(current.list({ ...all, kind: "decision" }).map((item) => item.kind)).toEqual(["decision"]);
    expect(current.list({ ...all, q: "100%" }).map((item) => item.title)).toEqual(["100% 完成"]);
    expect(current.list({ ...all, q: "%" }).map((item) => item.title)).toEqual(["100% 完成"]);
    expect(current.list({ ...all, scope: "personal" })).toEqual([]);
  });

  it("creates a new version and keeps the previous one", () => {
    const current = open();
    const created = current.create(fact);
    const revised = current.revise({
      action: "revise",
      id: created.id,
      kind: "decision",
      title: "例会时间已定",
      body: "周五下午三点，地点不变",
    });
    expect(revised.memory.version).toBe(2);
    expect(revised.memory.kind).toBe("decision");
    expect(revised.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(revised.versions[1]).toMatchObject({ title: "周五例会", body: "改到下午三点", kind: "fact" });
    expect(current.list(all)[0]).toMatchObject({ title: "例会时间已定", version: 2 });
    expect(() =>
      current.revise({
        action: "revise",
        id: created.id,
        kind: "decision",
        title: "例会时间已定",
        body: "周五下午三点，地点不变",
      }),
    ).toThrow(/不会生成新版本/);
    expect(current.detail(created.id).memory.version).toBe(2);
    expect(() => current.revise({ action: "revise", id: created.id, scope: "personal", kind: "fact", title: "标题", body: "内容" })).toThrow(
      /不能改工作区或授权/,
    );
  });

  it("forgets a memory without deleting chat records", () => {
    const current = open();
    const chat = new ChatStore(directory);
    const turn = chat.begin("day10-turn", chatText);
    chat.complete(turn.id, turn.attempt, "好的，这条对话还在", "demo", {});
    const created = current.create({ ...fact, body: "一条可以忘记的事实" });
    current.db.exec("PRAGMA wal_checkpoint(FULL)");
    chat.db.exec("PRAGMA wal_checkpoint(FULL)");
    expect(contains("opendot.sqlite", chatText)).toBe(true);
    expect(contains("memory.sqlite", chatText)).toBe(false);
    current.forget(created.id);
    expect(current.list(all)).toEqual([]);
    expect(current.list({ ...all, q: "忘记" })).toEqual([]);
    expect(() => current.detail(created.id)).toThrow(/找不到这条记忆/);
    expect(() => current.forget(created.id)).toThrow(/找不到这条记忆/);
    const versions = current.db
      .prepare("SELECT COUNT(*) AS count FROM memory_versions WHERE memory_id = ?")
      .get(created.id) as { count: number };
    expect(Number(versions.count)).toBe(1);
    const rows = chat.db.prepare("SELECT id, content, reply, status FROM turns").all();
    expect(rows).toEqual([
      { id: "day10-turn", content: chatText, reply: "好的，这条对话还在", status: "complete" },
    ]);
    chat.db.exec("PRAGMA wal_checkpoint(FULL)");
    expect(contains("opendot.sqlite", chatText)).toBe(true);
    const chatTables = chat.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));
    expect(chatTables).toContain("turns");
    expect(chatTables).not.toContain("memories");
    chat.db.close();
  });

  it("requires each personal memory to be authorized before another workspace can use it", () => {
    const current = open();
    const personal = current.create({
      kind: "fact",
      scope: "personal",
      title: "书写习惯",
      body: "我习惯用简体中文",
    });
    const product = current.create({
      kind: "decision",
      scope: "workspace",
      workspace: "产品",
      title: "冻结需求",
      body: "本周冻结需求",
    });
    const research = current.create({
      kind: "experience",
      scope: "workspace",
      workspace: "研究",
      title: "实验数据",
      body: "实验数据在本地",
    });
    const usable = (workspace: string) =>
      current.list({ ...all, forWorkspace: workspace }).map((item) => item.id);
    expect(personal.crossWorkspace).toBe(false);
    expect(usable("产品")).toEqual([product.id]);
    expect(usable("研究")).toEqual([research.id]);
    const allowed = current.authorize(personal.id, true);
    expect(allowed.crossWorkspace).toBe(true);
    expect(allowed.version).toBe(1);
    expect(usable("产品")).toContain(personal.id);
    expect(usable("产品")).toContain(product.id);
    expect(usable("产品")).not.toContain(research.id);
    expect(usable("研究")).toContain(personal.id);
    const revoked = current.authorize(personal.id, false);
    expect(revoked.crossWorkspace).toBe(false);
    expect(usable("产品")).not.toContain(personal.id);
    expect(usable("产品")).toContain(product.id);
    expect(() => current.authorize(product.id, true)).toThrow(/只有个人记忆可以逐条授权/);
    const row = current.db.prepare("SELECT cross_workspace AS crossWorkspace FROM memories WHERE id = ?").get(product.id) as {
      crossWorkspace: number;
    };
    expect(row.crossWorkspace).toBe(0);
  });

  it("toggles Mem0 locally and does not call the network", () => {
    const current = open();
    const created = current.create(fact);
    const fetchMock = vi.fn(() => Promise.reject(new Error("不应该访问网络")));
    vi.stubGlobal("fetch", fetchMock);
    expect(current.mem0Enabled()).toBe(false);
    expect(current.setMem0(true)).toBe(true);
    expect(current.setMem0(false)).toBe(false);
    expect(current.setMem0(true)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(current.list(all).map((item) => item.id)).toEqual([created.id]);
    current.db.close();
    store = new MemoryStore(directory);
    expect(store.mem0Enabled()).toBe(true);
    expect(store.detail(created.id).memory.title).toBe("周五例会");
  });

  it("stops at the memory and version limits", () => {
    const current = open();
    const now = Date.now();
    const insert = current.db.prepare(
      `INSERT INTO memories(
        id, kind, scope, workspace, title, body, cross_workspace, forgotten, version, created_at, updated_at
      ) VALUES (?, 'fact', 'workspace', '产品', '已有', '内容', 0, 0, 1, ?, ?)`,
    );
    const version = current.db.prepare(
      `INSERT INTO memory_versions(memory_id, version, kind, title, body, created_at)
       VALUES (?, 1, 'fact', '已有', '内容', ?)`,
    );
    for (let index = 0; index < MEMORY_LIMIT; index += 1) {
      const id = `mem_${index.toString(16).padStart(16, "0")}`;
      insert.run(id, now, now);
      version.run(id, now);
    }
    expect(() => current.create(fact)).toThrow(new RegExp(String(MEMORY_LIMIT)));
    current.forget(`mem_${"0".repeat(16)}`);
    const created = current.create({ ...fact, title: "补上的一条" });
    expect(created.title).toBe("补上的一条");
    for (let versionNumber = 2; versionNumber <= VERSION_LIMIT; versionNumber += 1) {
      current.revise({
        action: "revise",
        id: created.id,
        kind: "fact",
        title: `版本${versionNumber}`,
        body: "内容",
      });
    }
    expect(current.detail(created.id).memory.version).toBe(VERSION_LIMIT);
    expect(() =>
      current.revise({
        action: "revise",
        id: created.id,
        kind: "fact",
        title: "超出上限",
        body: "内容",
      }),
    ).toThrow(new RegExp(String(VERSION_LIMIT)));
  });

  it("follows DATA_DIR and keeps memories out of the other databases", () => {
    directory = mkdtempSync(join(tmpdir(), "opendot-memory-"));
    extra = mkdtempSync(join(tmpdir(), "opendot-memory-"));
    vi.stubEnv("DATA_DIR", directory);
    const first = getMemoryStore();
    const created = first.create(fact);
    vi.stubEnv("DATA_DIR", extra);
    const second = getMemoryStore();
    expect(second.directory).toBe(extra);
    expect(second.list(all)).toEqual([]);
    expect(second.mem0Enabled()).toBe(false);
    closeMemoryStore();
    vi.stubEnv("DATA_DIR", directory);
    expect(getMemoryStore().detail(created.id).memory.id).toBe(created.id);
  });
});
