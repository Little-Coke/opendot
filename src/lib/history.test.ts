import { expect, it } from "vitest";
import { mergeHistory } from "./history";
import type { Turn } from "./chat-types";
const unsent: Turn = {
  id: "unsent",
  content: "请保留这条消息",
  reply: "",
  status: "failed",
  error: "网络中断",
  attempt: 1,
  model: "",
  promptTokens: null,
  completionTokens: null,
  createdAt: 1,
  updatedAt: 1,
};
it("preserves unacknowledged failures after reconnect without duplicating acknowledged turns", () => {
  expect(mergeHistory([], [unsent])).toEqual([unsent]);
  const confirmed: Turn = {
    ...unsent,
    status: "complete",
    reply: "收到",
    error: null,
    updatedAt: 2,
  };
  expect(mergeHistory([confirmed], [unsent])).toEqual([confirmed]);
});
