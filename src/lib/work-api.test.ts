import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/work/route";
import { createSession } from "./auth";
import { closeWorkStore } from "./work";

let directory: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "opendot-work-api-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("OPENDOT_PASSWORD", "");
  vi.stubEnv("OPENAI_API_KEY", "test-provider-credential");
  vi.stubEnv("OPENAI_MODEL", "unit-model");
  vi.stubEnv("OPENAI_BASE_URL", "https://example.com/v1");
});

afterAll(() => {
  closeWorkStore();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function post(body: unknown, origin = "http://localhost") {
  return POST(
    new Request("http://localhost/api/work", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

async function list() {
  const response = await GET(new Request("http://localhost/api/work"));
  return { response, body: await response.json() };
}

const valid = {
  goal: "整理本周会议纪要",
  criteria: "纪要已写好\n\n已发给相关的人",
  workspace: " 个人 ",
  nextStep: " 先列出要整理的会议 ",
};

it("requires a login cookie once a password is configured", async () => {
  vi.stubEnv("OPENDOT_PASSWORD", "local-test-password");
  try {
    expect((await GET(new Request("http://localhost/api/work"))).status).toBe(401);
    const denied = await post(valid);
    expect(denied.status).toBe(401);
    const token = createSession();
    const allowed = await GET(
      new Request("http://localhost/api/work", {
        headers: { cookie: `opendot_session=${token}` },
      }),
    );
    expect(allowed.status).toBe(200);
    const payload = await allowed.json();
    expect(Array.isArray(payload.goals)).toBe(true);
  } finally {
    vi.stubEnv("OPENDOT_PASSWORD", "");
  }
});

it("creates a planned goal and lists it without touching chat or dot databases", async () => {
  const response = await post({ ...valid, status: "done", maxRuns: 12 });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const created = await response.json();
  expect(created).toMatchObject({
    goal: "整理本周会议纪要",
    criteria: ["纪要已写好", "已发给相关的人"],
    workspace: "个人",
    nextStep: "先列出要整理的会议",
    maxRuns: 12,
    status: "planned",
  });
  expect(created.id).toMatch(/^goal_[a-f0-9]{16}$/);

  const { response: listResponse, body } = await list();
  expect(listResponse.headers.get("cache-control")).toBe("no-store");
  expect(body.goals.map((goal: { id: string }) => goal.id)).toContain(created.id);
  expect(JSON.stringify(body)).not.toContain("test-provider-credential");

  const files = readdirSync(directory);
  expect(files.some((name) => name.startsWith("work.sqlite"))).toBe(true);
  expect(files.some((name) => name.startsWith("opendot"))).toBe(false);
  expect(files.some((name) => name.startsWith("dots"))).toBe(false);
});

it("rejects cross-site writes and out-of-range run limits without saving them", async () => {
  const before = (await list()).body.goals.length;
  expect((await post(valid, "https://evil.example")).status).toBe(403);
  expect(
    (
      await POST(
        new Request("http://localhost/api/work", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(valid),
        }),
      )
    ).status,
  ).toBe(403);
  for (const maxRuns of [0, 10001, 1.5, "10"]) {
    const rejected = await post({ ...valid, maxRuns });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toContain("1 到 10000");
  }
  expect((await post({ ...valid, criteria: "   " })).status).toBe(400);
  const after = await list();
  expect(after.body.goals).toHaveLength(before);
  expect(after.body.goals.some((goal: { maxRuns: number }) => goal.maxRuns === 10001)).toBe(false);
});
