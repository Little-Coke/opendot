import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatStore } from "./chat-store";

describe("persistent conversation", () => {
  let directory: string;
  let store: ChatStore;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "opendot-test-"));
    store = new ChatStore(directory);
  });
  afterEach(() => {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("restores completed turns after reopening the database", () => {
    const turn = store.begin("request-1", "我叫小可");
    store.complete(turn.id, turn.attempt, "你好，小可", "model-a", {
      prompt_tokens: 8,
      completion_tokens: 4,
    });
    store.db.close();
    store = new ChatStore(directory);
    expect(store.history()[0]).toMatchObject({
      content: "我叫小可",
      reply: "你好，小可",
      status: "complete",
      model: "model-a",
      completionTokens: 4,
    });
    expect(store.context()).toEqual([
      { role: "user", content: "我叫小可" },
      { role: "assistant", content: "你好，小可" },
    ]);
  });

  it("deduplicates requests and rejects changed content and concurrent turns", () => {
    const first = store.begin("same", "你好");
    expect(first.started).toBe(true);
    expect(store.begin("same", "你好").started).toBe(false);
    expect(() => store.begin("same", "不同内容")).toThrow();
    expect(() => store.begin("other", "并发")).toThrow();
    expect(store.history()).toHaveLength(1);
  });

  it("retries a failed turn once and fences off the previous attempt", () => {
    const first = store.begin("retry", "问题");
    store.fail(first.id, first.attempt, "连接中断");
    const retry = store.begin("retry", "问题", true);
    expect(retry.attempt).toBe(2);
    store.complete(first.id, first.attempt, "旧回复", "old", {});
    expect(store.history()[0].status).toBe("pending");
    store.complete(retry.id, retry.attempt, "新回复", "new", {});
    expect(store.history()).toHaveLength(1);
    expect(store.history()[0].reply).toBe("新回复");
  });

  it("retains partial output when an abandoned generation expires", () => {
    const turn = store.begin("expired", "你好");
    store.partial(turn.id, turn.attempt, "部分回答");
    store.db.prepare("UPDATE turns SET updated_at = 0").run();
    expect(store.history()[0]).toMatchObject({
      status: "failed",
      reply: "部分回答",
    });
    expect(store.context()).toEqual([]);
  });
});
