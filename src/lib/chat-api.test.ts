import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/chat/route";
import { getStore } from "./chat-store";
let server: Server;
let directory: string;
let calls = 0;
const prompts: { role: string; content: string }[][] = [];
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "opendot-api-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("OPENDOT_PASSWORD", "");
  vi.stubEnv("OPENAI_API_KEY", "test-provider-credential");
  vi.stubEnv("OPENAI_MODEL", "test-model");
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls++;
    prompts.push(JSON.parse(body).messages);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      'data: {"model":"test-model","choices":[{"delta":{"content":"你好，小可"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture failed");
  vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);
});
afterAll(async () => {
  getStore().db.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const request = (id: string, content: string) =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ id, content }),
  });
it("streams real provider responses, persists turns, deduplicates and forwards conversation context", async () => {
  expect((await GET(new Request("http://localhost/api/chat"))).status).toBe(
    200,
  );
  expect(calls).toBe(0);
  const response = await POST(request("request-one", "我叫小可"));
  expect(response.headers.get("content-type")).toContain("ndjson");
  expect(await response.text()).toContain("你好，小可");
  await (await POST(request("request-one", "我叫小可"))).text();
  expect(calls).toBe(1);
  await (await POST(request("request-two", "我叫什么"))).text();
  expect(prompts[1]).toContainEqual({
    role: "assistant",
    content: "你好，小可",
  });
  expect(prompts[1]).toContainEqual({ role: "user", content: "我叫小可" });
  const data = await (
    await GET(new Request("http://localhost/api/chat"))
  ).json();
  expect(data.turns).toHaveLength(2);
  expect(data.turns[1].status).toBe("complete");
  expect(JSON.stringify(data)).not.toContain("test-provider-credential");
});
it("rejects malformed input without creating a turn or calling the provider", async () => {
  const before = calls;
  expect((await POST(request("invalid", "   "))).status).toBe(400);
  expect(calls).toBe(before);
});
