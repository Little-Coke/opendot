import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/devices/route";
import { POST } from "@/app/api/devices/pair/route";
import { closeChannelStore } from "./channels";

let directory = "";

afterAll(() => {
  closeChannelStore();
  if (directory) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function setup() {
  closeChannelStore();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = mkdtempSync(join(tmpdir(), "opendot-devices-api-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("OPENDOT_PASSWORD", "");
  vi.stubEnv("NODE_ENV", "test");
}

function put(body: unknown, origin = "http://localhost") {
  return PUT(
    new Request("http://localhost/api/devices", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

function pair(body: unknown) {
  return POST(
    new Request("http://localhost/api/devices/pair", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify(body),
    }),
  );
}

it("starts with device nodes disabled", async () => {
  setup();
  const response = await GET(new Request("http://localhost/api/devices"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.nodesEnabled).toBe(false);
  expect(body.offlinePolicy).toBe("wait");
  expect(body.offlinePolicyText).toContain("不会改派");
  expect(body.devices).toEqual([]);
  const blocked = await pair({ action: "issue" });
  expect(blocked.status).toBe(400);
  expect((await blocked.json()).error).toContain("尚未开启");
});

it("pairs a simulated local node and does not reassign it while offline", async () => {
  setup();
  const enabled = await put({ nodesEnabled: true });
  expect(enabled.status).toBe(200);
  expect((await enabled.json()).nodesEnabled).toBe(true);
  const issued = await pair({ action: "issue" });
  expect(issued.status).toBe(200);
  const code = (await issued.json()).code as string;
  const wrong = code === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA";
  const denied = await pair({ action: "simulate", code: wrong, name: "本地节点" });
  expect(denied.status).toBe(400);
  expect((await denied.json()).error).toBe("配对码不正确，已拒绝");
  const created = await pair({ action: "simulate", code, name: "书房电脑" });
  expect(created.status).toBe(201);
  const device = await created.json();
  expect(device).toMatchObject({
    name: "书房电脑",
    status: "online",
    assignment: "wait",
    reassign: false,
  });
  expect(JSON.stringify(device)).not.toContain(code);
  const reassigned = await put({ id: device.id, status: "offline", assignment: "reassign" });
  expect(reassigned.status).toBe(400);
  expect((await reassigned.json()).error).toContain("不能改派");
  const offline = await put({ id: device.id, status: "offline" });
  expect(offline.status).toBe(200);
  const snapshot = await offline.json();
  expect(snapshot.devices[0]).toMatchObject({
    id: device.id,
    status: "offline",
    assignment: "wait",
    reassign: false,
  });
  expect(snapshot.devices[0].assignmentText).toContain("不会改派");
  const listed = await GET(new Request("http://localhost/api/devices"));
  expect((await listed.json()).devices[0].status).toBe("offline");
});
