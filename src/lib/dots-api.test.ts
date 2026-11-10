import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { DELETE, GET as GET_ONE } from "@/app/api/dots/[id]/route";
import { GET, POST } from "@/app/api/dots/route";
import { createSession } from "./auth";
import { getStore } from "./chat-store";
import { closeDotStore } from "./dots";

let directory: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "opendot-dots-api-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("OPENDOT_PASSWORD", "");
  vi.stubEnv("OPENAI_API_KEY", "test-provider-credential");
  vi.stubEnv("OPENAI_MODEL", "unit-model");
  vi.stubEnv("OPENAI_BASE_URL", "https://example.com/v1");
});

afterAll(() => {
  closeDotStore();
  try {
    getStore().db.close();
  } catch {
    // 聊天库可能尚未打开。
  }
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function post(body: unknown, origin = "http://localhost") {
  return POST(
    new Request("http://localhost/api/dots", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

it("requires a login cookie once a password is configured", async () => {
  vi.stubEnv("OPENDOT_PASSWORD", "local-test-password");
  try {
    expect((await GET(new Request("http://localhost/api/dots"))).status).toBe(401);
    const denied = await post({ name: "越权", shape: "circle", color: "#3b82f6" });
    expect(denied.status).toBe(401);
    const token = createSession();
    const allowed = await GET(
      new Request("http://localhost/api/dots", {
        headers: { cookie: `opendot_session=${token}` },
      }),
    );
    expect(allowed.status).toBe(200);
  } finally {
    vi.stubEnv("OPENDOT_PASSWORD", "");
  }
});

it("creates a dot, lists it with the default model, and does not touch the chat tables", async () => {
  const response = await post({
    name: " 资料员 ",
    shape: "hexagon",
    color: "#8b5cf6",
    role: "整理每周资料",
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const created = await response.json();
  expect(created).toMatchObject({
    name: "资料员",
    shape: "hexagon",
    color: "#8b5cf6",
    role: "整理每周资料",
  });

  const listResponse = await GET(new Request("http://localhost/api/dots"));
  const list = await listResponse.json();
  expect(list.defaultModel).toBe("默认模型 · unit-model");
  expect(list.recent).toBe("还没有独立对话");
  expect(list.dots.map((dot: { id: string }) => dot.id)).toContain(created.id);
  expect(JSON.stringify(list)).not.toContain("test-provider-credential");

  const detail = await (
    await GET_ONE(new Request(`http://localhost/api/dots/${created.id}`), context(created.id))
  ).json();
  expect(detail.tabs.map((tab: { label: string }) => tab.label)).toEqual([
    "对话",
    "当前工作",
    "能力",
    "记忆",
    "设置",
  ]);
  for (const id of ["skills", "memory", "settings"]) {
    expect(detail.tabs.find((tab: { id: string }) => tab.id === id).body.length).toBeGreaterThan(20);
  }

  const chat = new DatabaseSync(join(directory, "opendot.sqlite"));
  const names = chat
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String(row.name));
  chat.close();
  expect(names).toContain("turns");
  expect(names).not.toContain("dots");

  expect((await GET_ONE(new Request("http://localhost/api/dots/xiaodian"), context("xiaodian"))).status).toBe(404);
  const removed = await DELETE(
    new Request(`http://localhost/api/dots/${created.id}`, {
      method: "DELETE",
      headers: { origin: "http://localhost" },
    }),
    context(created.id),
  );
  expect(removed.status).toBe(200);
  expect(
    (await GET_ONE(new Request(`http://localhost/api/dots/${created.id}`), context(created.id))).status,
  ).toBe(404);
});

it("rejects cross-site writes and invalid profiles", async () => {
  expect((await post({ name: "越权", shape: "circle", color: "#3b82f6" }, "https://evil.example")).status).toBe(403);
  expect(
    (
      await POST(
        new Request("http://localhost/api/dots", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "缺来源", shape: "circle", color: "#3b82f6" }),
        }),
      )
    ).status,
  ).toBe(403);
  expect((await post({ name: "小点", shape: "circle", color: "#3ecf8e" })).status).toBe(400);
  expect((await post({ name: "坏颜色", shape: "circle", color: "#ffffff" })).status).toBe(400);
  const list = await (await GET(new Request("http://localhost/api/dots"))).json();
  expect(list.dots.some((dot: { name: string }) => dot.name === "小点" || dot.name === "坏颜色")).toBe(false);
});
