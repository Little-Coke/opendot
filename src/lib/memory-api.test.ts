import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/memory/route";
import { createSession } from "./auth";
import { ChatStore } from "./chat-store";
import { closeMemoryStore } from "./memory";

let directory = "";
const chatText = "接口忘记记忆时要留下的聊天";

function setup(password = "") {
  closeMemoryStore();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = mkdtempSync(join(tmpdir(), "opendot-memory-api-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("OPENDOT_PASSWORD", password);
  vi.stubEnv("NODE_ENV", "test");
}

afterAll(() => {
  closeMemoryStore();
  if (directory) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function post(body: unknown, origin = "http://localhost") {
  return POST(
    new Request("http://localhost/api/memory", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const personal = {
  action: "create",
  kind: "fact",
  scope: "personal",
  title: "书写习惯",
  body: "我习惯用简体中文",
};

it("requires a login cookie once a password is configured", async () => {
  setup("local-test-password");
  expect((await GET(new Request("http://localhost/api/memory"))).status).toBe(401);
  expect((await post(personal)).status).toBe(401);
  const token = createSession();
  const allowed = await GET(
    new Request("http://localhost/api/memory", {
      headers: { cookie: `opendot_session=${token}` },
    }),
  );
  expect(allowed.status).toBe(200);
  const payload = await allowed.json();
  expect(payload.mem0Enabled).toBe(false);
  expect(payload.memories).toEqual([]);
});

it("creates, searches, and keeps older versions", async () => {
  setup();
  const created = await post({
    action: "create",
    kind: "follow_up",
    scope: "workspace",
    workspace: "产品",
    title: "提醒小李",
    body: "请小李看纪要",
  });
  expect(created.status).toBe(201);
  expect(created.headers.get("cache-control")).toBe("no-store");
  const memory = (await created.json()).memory;
  expect(memory).toMatchObject({
    kind: "follow_up",
    scope: "workspace",
    workspace: "产品",
    title: "提醒小李",
    version: 1,
    crossWorkspace: false,
  });
  expect(memory.id).toMatch(/^mem_[a-f0-9]{16}$/);
  const missed = await GET(new Request(`http://localhost/api/memory?q=${encodeURIComponent("不存在")}`));
  expect((await missed.json()).memories).toEqual([]);
  const found = await GET(new Request(`http://localhost/api/memory?q=${encodeURIComponent("纪要")}&kind=follow_up`));
  expect((await found.json()).memories.map((item: { id: string }) => item.id)).toEqual([memory.id]);
  const revised = await post({
    action: "revise",
    id: memory.id,
    kind: "decision",
    title: "纪要改由小李整理",
    body: "周五前完成",
  });
  expect(revised.status).toBe(200);
  const saved = await revised.json();
  expect(saved.memory.version).toBe(2);
  const detail = await GET(new Request(`http://localhost/api/memory?id=${memory.id}`));
  const history = await detail.json();
  expect(history.versions.map((version: { title: string }) => version.title)).toEqual([
    "纪要改由小李整理",
    "提醒小李",
  ]);
  expect(history.versions[1].kind).toBe("follow_up");
  const same = await post({
    action: "revise",
    id: memory.id,
    kind: "decision",
    title: "纪要改由小李整理",
    body: "周五前完成",
  });
  expect(same.status).toBe(400);
  expect((await same.json()).error).toBe("内容没有变化，不会生成新版本");
});

it("forgets a memory without deleting chat records", async () => {
  setup();
  const chat = new ChatStore(directory);
  const turn = chat.begin("day10-api", chatText);
  chat.complete(turn.id, turn.attempt, "聊天还在", "demo", {});
  chat.db.close();
  const created = await post({
    action: "create",
    kind: "fact",
    scope: "workspace",
    workspace: "产品",
    title: "可忘记",
    body: "这条记忆可以被忘记",
  });
  const id = (await created.json()).memory.id as string;
  const forgotten = await post({ action: "forget", id });
  expect(forgotten.status).toBe(200);
  expect(await forgotten.json()).toMatchObject({ forgotten: true, mem0Enabled: false });
  const listed = await GET(new Request("http://localhost/api/memory"));
  expect((await listed.json()).memories).toEqual([]);
  expect((await GET(new Request(`http://localhost/api/memory?id=${id}`))).status).toBe(404);
  const check = new DatabaseSync(join(directory, "opendot.sqlite"));
  const rows = check.prepare("SELECT id, content, reply, status FROM turns").all();
  check.close();
  expect(rows).toEqual([{ id: "day10-api", content: chatText, reply: "聊天还在", status: "complete" }]);
  const names = readdirSync(directory);
  expect(names.some((name) => name.startsWith("memory.sqlite"))).toBe(true);
  expect(names.some((name) => name.startsWith("opendot"))).toBe(true);
  expect(names.some((name) => name.startsWith("dots"))).toBe(false);
  expect(names.some((name) => name.startsWith("work"))).toBe(false);
  expect(names.some((name) => name.startsWith("channels"))).toBe(false);
});

it("authorizes personal memories one by one for other workspaces", async () => {
  setup();
  const created = await post(personal);
  expect(created.status).toBe(201);
  const memory = (await created.json()).memory;
  expect(memory.crossWorkspace).toBe(false);
  await post({
    action: "create",
    kind: "decision",
    scope: "workspace",
    workspace: "产品",
    title: "冻结需求",
    body: "本周冻结需求",
  });
  await post({
    action: "create",
    kind: "experience",
    scope: "workspace",
    workspace: "研究",
    title: "实验数据",
    body: "实验数据在本地",
  });
  const before = await GET(new Request(`http://localhost/api/memory?forWorkspace=${encodeURIComponent("产品")}`));
  const hidden = (await before.json()).memories as { id: string; scope: string }[];
  expect(hidden.map((item) => item.scope)).toEqual(["workspace"]);
  expect(hidden.some((item) => item.id === memory.id)).toBe(false);
  const denied = await post({ action: "authorize", id: hidden[0].id, crossWorkspace: true });
  expect(denied.status).toBe(400);
  expect((await denied.json()).error).toBe("只有个人记忆可以逐条授权跨工作区使用");
  const allowed = await post({ action: "authorize", id: memory.id, crossWorkspace: true });
  expect(allowed.status).toBe(200);
  expect((await allowed.json()).memory.crossWorkspace).toBe(true);
  const after = await GET(new Request(`http://localhost/api/memory?forWorkspace=${encodeURIComponent("产品")}`));
  const visible = (await after.json()).memories as { id: string }[];
  expect(visible.map((item) => item.id)).toContain(memory.id);
  const research = await GET(new Request(`http://localhost/api/memory?forWorkspace=${encodeURIComponent("研究")}`));
  const researchIds = ((await research.json()).memories as { title: string }[]).map((item) => item.title);
  expect(researchIds).toContain("书写习惯");
  expect(researchIds).not.toContain("冻结需求");
  const revoked = await post({ action: "authorize", id: memory.id, crossWorkspace: false });
  expect((await revoked.json()).memory.crossWorkspace).toBe(false);
  const again = await GET(new Request(`http://localhost/api/memory?forWorkspace=${encodeURIComponent("产品")}`));
  expect(((await again.json()).memories as { id: string }[]).some((item) => item.id === memory.id)).toBe(false);
});

it("keeps Mem0 off by default and does not call Mem0", async () => {
  setup();
  const fetchMock = vi.fn(() => Promise.reject(new Error("不应该访问网络")));
  vi.stubGlobal("fetch", fetchMock);
  const first = await GET(new Request("http://localhost/api/memory"));
  expect((await first.json()).mem0Enabled).toBe(false);
  const enabled = await post({ action: "mem0", enabled: true });
  expect(enabled.status).toBe(200);
  expect(await enabled.json()).toEqual({ mem0Enabled: true });
  expect(fetchMock).not.toHaveBeenCalled();
  const listed = await GET(new Request("http://localhost/api/memory"));
  expect((await listed.json()).mem0Enabled).toBe(true);
  const disabled = await post({ action: "mem0", enabled: false });
  expect((await disabled.json()).mem0Enabled).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects cross-site writes", async () => {
  setup();
  expect((await post({ action: "mem0", enabled: true }, "https://evil.example")).status).toBe(403);
  expect((await post(personal, "")).status).toBe(403);
  const listed = await GET(new Request("http://localhost/api/memory"));
  const body = await listed.json();
  expect(body.mem0Enabled).toBe(false);
  expect(body.memories).toEqual([]);
});
