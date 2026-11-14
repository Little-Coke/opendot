import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { POST as createGoal } from "@/app/api/work/route";
import { GET, POST } from "@/app/api/work/[id]/route";
import { createSession } from "./auth";
import { RUN_DURATION_MS, STEP_LIMIT } from "./work-profile";
import { closeWorkStore, getWorkStore } from "./work";

let directory: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "opendot-work-run-"));
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

const valid = {
  goal: "整理本周会议纪要",
  criteria: "纪要已写好",
  workspace: "个人",
  nextStep: "先列出要整理的会议",
};

function create(extra: Record<string, unknown> = {}) {
  return createGoal(
    new Request("http://localhost/api/work", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ ...valid, ...extra }),
    }),
  );
}

function post(id: string, body: unknown, origin = "http://localhost") {
  return POST(
    new Request(`http://localhost/api/work/${id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function read(id: string, cookie?: string) {
  return GET(
    new Request(`http://localhost/api/work/${id}`, {
      headers: cookie ? { cookie } : undefined,
    }),
    { params: Promise.resolve({ id }) },
  );
}

it("requires a login cookie before reading or advancing a goal", async () => {
  vi.stubEnv("OPENDOT_PASSWORD", "local-test-password");
  try {
    expect((await read("goal_0123456789abcdef")).status).toBe(401);
    expect((await post("goal_0123456789abcdef", { action: "start" })).status).toBe(401);
    const token = createSession();
    const allowed = await read("goal_0123456789abcdef", `opendot_session=${token}`);
    expect(allowed.status).toBe(404);
    expect((await allowed.json()).error).toContain("找不到");
  } finally {
    vi.stubEnv("OPENDOT_PASSWORD", "");
  }
});

it("reuses the same run on resume and rejects completion without evidence", async () => {
  const created = await (await create()).json();
  const missing = await read("goal_0123456789abcdef");
  expect(missing.status).toBe(404);

  const startedResponse = await post(created.id, { action: "start", id: "run_injected" });
  expect(startedResponse.status).toBe(200);
  expect(startedResponse.headers.get("cache-control")).toBe("no-store");
  const started = await startedResponse.json();
  const runId = started.runs[0].id as string;
  expect(runId).toMatch(/^run_[a-f0-9]{16}$/);
  expect(runId).not.toBe("run_injected");
  expect(started.goal).toMatchObject({ status: "active", runsUsed: 1, runStatus: "running" });
  expect(started.runs[0]).toMatchObject({ maxSteps: STEP_LIMIT, maxDurationMs: RUN_DURATION_MS, steps: 0 });

  const paused = await (await post(created.id, { action: "pause" })).json();
  expect(paused.runs[0]).toMatchObject({ id: runId, status: "paused" });
  const resumed = await (await post(created.id, { action: "resume" })).json();
  expect(resumed.runs).toHaveLength(1);
  expect(resumed.runs[0].id).toBe(runId);
  expect(resumed.goal.runsUsed).toBe(1);

  const blocked = await post(created.id, { action: "complete" });
  expect(blocked.status).toBe(400);
  expect((await blocked.json()).error).toContain("还没有证据");
  expect(await (await read(created.id)).json()).toMatchObject({
    goal: { status: "active" },
    runs: [{ id: runId, status: "running" }],
  });

  const noted = await (await post(created.id, { action: "evidence", kind: "note", note: "纪要已写好" })).json();
  expect(noted.evidence[0]).toMatchObject({ kind: "note", note: "纪要已写好", runId });
  const done = await (await post(created.id, { action: "complete" })).json();
  expect(done.goal.status).toBe("done");
  expect(done.runs[0]).toMatchObject({ id: runId, status: "completed" });
  expect(JSON.stringify(done)).not.toContain("test-provider-credential");
});

it("requires device evidence, blocks a second run past the budget, and stops at 12 steps", async () => {
  const deviceGoal = await (await create({ goal: "导出照片", requiresDevice: true, maxRuns: 1 })).json();
  expect(deviceGoal.requiresDevice).toBe(true);
  await post(deviceGoal.id, { action: "start" });
  await post(deviceGoal.id, { action: "evidence", kind: "note", note: "照片已导出" });
  const rejected = await post(deviceGoal.id, { action: "complete" });
  expect(rejected.status).toBe(400);
  expect((await rejected.json()).error).toContain("设备证据");
  const stillRunning = await (await read(deviceGoal.id)).json();
  expect(stillRunning.goal.status).toBe("active");
  await post(deviceGoal.id, { action: "evidence", kind: "device", note: "从手机读取了相册" });
  expect((await (await post(deviceGoal.id, { action: "complete" })).json()).goal.status).toBe("done");

  const limited = await (await create({ goal: "只执行一次", maxRuns: 1 })).json();
  await post(limited.id, { action: "start" });
  await post(limited.id, { action: "cancel" });
  const overBudget = await post(limited.id, { action: "start" });
  expect(overBudget.status).toBe(400);
  expect((await overBudget.json()).error).toContain("执行次数已用完");
  expect(await (await read(limited.id)).json()).toMatchObject({ goal: { runsUsed: 1 } });

  const stepped = await (await create({ goal: "数步骤" })).json();
  await post(stepped.id, { action: "start" });
  for (let index = 0; index < STEP_LIMIT; index += 1) {
    const response = await post(stepped.id, { action: "step" });
    expect(response.status).toBe(200);
  }
  const tooMany = await post(stepped.id, { action: "step" });
  expect(tooMany.status).toBe(400);
  expect((await tooMany.json()).error).toContain("12 步");
  expect(await (await read(stepped.id)).json()).toMatchObject({
    runs: [{ steps: STEP_LIMIT, maxSteps: STEP_LIMIT, maxDurationMs: RUN_DURATION_MS }],
  });

  const expired = await (await create({ goal: "超时" })).json();
  const running = await (await post(expired.id, { action: "start" })).json();
  getWorkStore()
    .db.prepare("UPDATE runs SET started_at = ? WHERE id = ?")
    .run(Date.now() - RUN_DURATION_MS, running.runs[0].id);
  const late = await post(expired.id, { action: "step" });
  expect(late.status).toBe(400);
  expect((await late.json()).error).toContain("30 分钟");
});

it("rejects cross-site run changes and does not save them", async () => {
  const created = await (await create({ goal: "不要被跨站改掉" })).json();
  expect((await post(created.id, { action: "start" }, "https://evil.example")).status).toBe(403);
  expect(
    (
      await POST(
        new Request(`http://localhost/api/work/${created.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        }),
        { params: Promise.resolve({ id: created.id }) },
      )
    ).status,
  ).toBe(403);
  const detail = await (await read(created.id)).json();
  expect(detail.goal.runsUsed).toBe(0);
  expect(detail.runs).toEqual([]);
});
