import { describe, expect, it } from "vitest";
import { readCompletionStream, normalizeBaseUrl } from "./provider";

function body(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3)
        controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  });
}

describe("OpenAI compatible streaming", () => {
  it("decodes split UTF-8 and CRLF frames, retaining model and usage", async () => {
    const chunks: string[] = [];
    const result = await readCompletionStream(
      body(
        'data: {"model":"model-a","choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      ),
      (text) => chunks.push(text),
    );
    expect(chunks.join("")).toBe("你好世界");
    expect(result).toMatchObject({
      text: "你好世界",
      model: "model-a",
      usage: { prompt_tokens: 8, completion_tokens: 2 },
    });
  });
  it("rejects truncated streams rather than saving a partial answer as success", async () => {
    await expect(
      readCompletionStream(
        body('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
        () => {},
      ),
    ).rejects.toThrow();
  });
  it("rejects provider errors without exposing their contents", async () => {
    await expect(
      readCompletionStream(
        body('data: {"error":{"message":"secret-provider-data"}}\n\n'),
        () => {},
      ),
    ).rejects.toThrow("模型服务返回错误");
  });
  it("normalizes an API base and rejects embedded credentials and non-http URLs", () => {
    expect(normalizeBaseUrl("https://example.com/v1/")).toBe(
      "https://example.com/v1",
    );
    expect(() => normalizeBaseUrl("file:///etc/passwd")).toThrow();
    expect(() =>
      normalizeBaseUrl("https://user:password@example.com/v1"),
    ).toThrow();
    expect(() => normalizeBaseUrl("https://example.com/v1?token=x")).toThrow();
  });
});
