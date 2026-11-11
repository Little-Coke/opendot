// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatStage } from "./chat";

const snapshot = {
  turns: [],
  settings: {
    baseUrl: "https://example.com/v1",
    model: "test",
    hasKey: true,
    source: "settings",
  },
};
let container: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(createElement(ChatStage)));
}
async function typeMessage() {
  const input = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, "你好");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
it("blocks Enter until history is loaded", async () => {
  fetcher.mockImplementation(() => new Promise(() => {}));
  await mount();
  const input = await typeMessage();
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(0);
});
it("recovers failed history reads automatically and clears the connection error", async () => {
  fetcher.mockRejectedValueOnce(new Error("network offline"));
  fetcher.mockImplementation(() => Promise.resolve(Response.json(snapshot)));
  await mount();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(container.textContent).toContain("已连接服务端");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(fetcher.mock.calls.every(([, options]) => !options?.method)).toBe(
    true,
  );
});
it("does not let an older failed read overwrite a successful reconnect", async () => {
  let rejectOld!: (error: Error) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  fetcher.mockImplementation(() => Promise.resolve(Response.json(snapshot)));
  await mount();
  await act(async () => window.dispatchEvent(new Event("online")));
  await act(async () => rejectOld(new Error("stale failure")));
  expect(container.textContent).toContain("已连接服务端");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("lets slow successful history reads finish before polling again", async () => {
  fetcher.mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(Response.json(snapshot)), 6000);
      }),
  );
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(6500));
  expect(container.textContent).toContain("已连接服务端");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
