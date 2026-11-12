import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/channels/route";
import { POST as pair } from "@/app/api/channels/pair/route";
import { POST as telegram } from "@/app/api/channels/telegram/route";
import { createSession } from "./auth";
import { closeChannelStore } from "./channels";

let directory = "";

function setup(password = "") {
  closeChannelStore();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = mkdtempSync(join(tmpdir(), "opendot-channels-api-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("OPENDOT_PASSWORD", password);
  vi.stubEnv("NODE_ENV", "test");
}

afterAll(() => {
  closeChannelStore();
  if (directory) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function write(body: unknown, origin = "http://localhost") {
  return PUT(
    new Request("http://localhost/api/channels", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const secret = "unit-secret-token-should-not-leak";
const telegramToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";

it("requires a login cookie once a password is configured", async () => {
  setup("local-test-password");
  expect((await GET(new Request("http://localhost/api/channels"))).status).toBe(401);
  const denied = await write({ groupReply: "all" });
  expect(denied.status).toBe(401);
  const token = createSession();
  const allowed = await GET(
    new Request("http://localhost/api/channels", {
      headers: { cookie: `opendot_session=${token}` },
    }),
  );
  expect(allowed.status).toBe(200);
  const payload = await allowed.json();
  expect(payload.groupReply).toBe("mention");
  expect(payload.channels).toHaveLength(7);
});

it("hides saved credentials and rejects a wrong /pair code", async () => {
  setup();
  const saved = await write({
    id: "discord",
    enabled: true,
    credentials: { botToken: secret },
  });
  expect(saved.status).toBe(200);
  const body = await saved.json();
  expect(JSON.stringify(body)).not.toContain(secret);
  expect(body.channels.find((channel: { id: string }) => channel.id === "discord").credentials[0]).toEqual({
    key: "botToken",
    label: "Bot Token",
    configured: true,
  });
  const issued = await pair(
    new Request("http://localhost/api/channels/pair", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ action: "issue", channelId: "discord" }),
    }),
  );
  expect(issued.status).toBe(200);
  const code = (await issued.json()).code as string;
  const wrong = code === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA";
  const rejected = await pair(
    new Request("http://localhost/api/channels/pair", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ action: "submit", text: `/pair ${wrong}` }),
    }),
  );
  expect(rejected.status).toBe(400);
  expect((await rejected.json()).error).toBe("配对码不正确，已拒绝");
  const accepted = await pair(
    new Request("http://localhost/api/channels/pair", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ action: "submit", text: `/pair ${code}` }),
    }),
  );
  expect(accepted.status).toBe(200);
  const listed = await GET(new Request("http://localhost/api/channels"));
  const snapshot = await listed.json();
  expect(snapshot.channels.find((channel: { id: string }) => channel.id === "discord").paired).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain(secret);
  expect(JSON.stringify(snapshot)).not.toContain(code);
  const names = readdirSync(directory);
  expect(names.some((name) => name.startsWith("channels.sqlite"))).toBe(true);
  expect(names.some((name) => name.startsWith("opendot"))).toBe(false);
  expect(names.some((name) => name.startsWith("dots"))).toBe(false);
  expect(names.some((name) => name.startsWith("work"))).toBe(false);
});

it("returns a Chinese error when Telegram getMe cannot be reached", async () => {
  setup();
  await write({ id: "telegram", enabled: true, credentials: { botToken: telegramToken } });
  vi.stubGlobal("fetch", (url: string) => Promise.reject(new TypeError(`network down ${url}`)));
  const response = await telegram(
    new Request("http://localhost/api/channels/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({}),
    }),
  );
  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body.error).toBe("无法连接 Telegram，请检查网络后重试");
  expect(JSON.stringify(body)).not.toContain(telegramToken);
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ ok: false, description: `Unauthorized ${telegramToken}` }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
  );
  const rejected = await telegram(
    new Request("http://localhost/api/channels/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ token: telegramToken }),
    }),
  );
  expect(rejected.status).toBe(400);
  const rejectedBody = await rejected.json();
  expect(rejectedBody.error).toBe("Telegram 拒绝了这个 Token");
  expect(JSON.stringify(rejectedBody)).not.toContain(telegramToken);
});

it("rejects cross-site channel writes", async () => {
  setup();
  expect((await write({ groupReply: "all" }, "https://evil.example")).status).toBe(403);
  expect((await GET(new Request("http://localhost/api/channels"))).status).toBe(200);
  const snapshot = await (await GET(new Request("http://localhost/api/channels"))).json();
  expect(snapshot.groupReply).toBe("mention");
});
