"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DotFace } from "./shell";
import { mergeHistory } from "@/lib/history";
import type {
  ChatEvent,
  ChatSnapshot,
  ModelSettings,
  Turn,
} from "@/lib/chat-types";

function requestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function ChatStage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(false);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const activeRequest = useRef<AbortController | null>(null);
  const readVersion = useRef(0);
  const pending = turns.some((turn) => turn.status === "pending");
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++readVersion.current;
    try {
      const response = await fetch("/api/chat", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取对话失败");
      const snapshot = data as ChatSnapshot;
      if (version !== readVersion.current) return;
      setTurns((local) => mergeHistory(snapshot.turns, local));
      setSettings(snapshot.settings);
      setLoaded(true);
      setOnline(true);
    } catch (failure) {
      if (signal?.aborted) return;
      setOnline(false);
      setError(failure instanceof Error ? failure.message : "无法连接服务端");
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => {
      abort.abort();
      activeRequest.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    if (!pending || sending) return;
    const interval = setInterval(() => void load(), 2000);
    return () => clearInterval(interval);
  }, [pending, sending, load]);
  useEffect(() => {
    if (pinned.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [turns]);

  async function send(content: string, id = requestId(), retry = false) {
    if (sending || pending || !content.trim()) return;
    readVersion.current++;
    setSending(true);
    setError("");
    pinned.current = true;
    const now = Date.now();
    setTurns((previous) => {
      const existing = previous.find((turn) => turn.id === id);
      if (existing)
        return previous.map((turn) =>
          turn.id === id
            ? { ...turn, status: "pending", reply: "", error: null }
            : turn,
        );
      return [
        ...previous,
        {
          id,
          content: content.trim(),
          reply: "",
          status: "pending",
          error: null,
          attempt: 1,
          model: "",
          promptTokens: null,
          completionTokens: null,
          createdAt: now,
          updatedAt: now,
        },
      ];
    });
    if (!retry) setDraft("");
    const abort = new AbortController();
    activeRequest.current = abort;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, content: content.trim(), retry }),
      });
      if (!response.ok || !response.body) {
        const result = await response.json();
        throw new Error(result.error || "发送失败，请重试");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!line.trim()) continue;
            const event: ChatEvent = JSON.parse(line);
            if (event.type === "delta") {
              setTurns((previous) =>
                previous.map((turn) =>
                  turn.id === event.id
                    ? { ...turn, reply: turn.reply + event.text }
                    : turn,
                ),
              );
            } else {
              setTurns(event.turns);
              if (event.type === "error") setError(event.error);
            }
          }
          if (chunk.done) break;
        }
      } finally {
        reader.releaseLock();
      }
      setOnline(true);
      await load();
    } catch (failure) {
      if (abort.signal.aborted) return;
      const message =
        failure instanceof Error ? failure.message : "连接中断，请重新连接";
      setError(message);
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === id ? { ...turn, status: "failed", error: message } : turn,
        ),
      );
      setOnline(false);
    } finally {
      activeRequest.current = null;
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-3">
        <Link
          href="/"
          className="text-muted lg:hidden"
          aria-label="返回会话列表"
        >
          ←
        </Link>
        <DotFace />
        <div className="min-w-0">
          <div className="font-medium">小点</div>
          <div className="truncate text-xs text-muted">
            {settings?.hasKey ? settings.model : "你的个人协调员 · 演示模式"}
          </div>
        </div>
        <span className="ml-auto shrink-0 text-xs text-muted" role="status">
          {online ? "已连接服务端" : loaded ? "连接已断开" : "正在连接…"}
        </span>
      </header>
      {settings && !settings.hasKey && (
        <div className="border-b border-line bg-accent-soft px-4 py-2 text-center text-xs text-accent">
          当前为演示模式 ·{" "}
          <Link href="/settings" className="underline">
            配置模型以开始真实对话
          </Link>
        </div>
      )}
      <div
        ref={list}
        onScroll={() => {
          const element = list.current;
          if (element)
            pinned.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              100;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
        aria-label="对话消息"
      >
        {turns.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center text-center">
            <span className="mb-5 scale-150">
              <DotFace />
            </span>
            <h1 className="text-xl font-medium">今天需要我帮你处理什么？</h1>
            <p className="mt-3 text-sm text-muted">
              我是小点。可以一起讨论、写作，或梳理你的想法。
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-8">
            {turns.map((turn, index) => (
              <article key={turn.id} className="space-y-4">
                <div className="flex justify-end">
                  <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-accent px-4 py-3 text-sm leading-7 text-white">
                    {turn.content}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-1 shrink-0">
                    <DotFace />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-xs font-medium text-muted">
                      小点{turn.model === "演示模式" ? " · 演示回复" : ""}
                    </div>
                    <div className="whitespace-pre-wrap break-words text-sm leading-7">
                      {turn.reply ||
                        (turn.status === "pending"
                          ? "正在思考…"
                          : "回复尚未完成")}
                    </div>
                    {turn.status === "pending" && (
                      <p className="mt-2 text-xs text-muted" role="status">
                        正在回复…
                      </p>
                    )}
                    {turn.status === "failed" && (
                      <div className="mt-3 text-sm text-red-600">
                        <p>{turn.error}</p>
                        {index === turns.length - 1 && (
                          <button
                            className="mt-2 rounded-lg border border-line px-3 py-1 text-ink disabled:opacity-50"
                            disabled={sending || pending}
                            onClick={() =>
                              void send(turn.content, turn.id, true)
                            }
                          >
                            重试这条消息
                          </button>
                        )}
                      </div>
                    )}
                    {turn.status === "complete" &&
                      turn.completionTokens !== null && (
                        <p className="mt-2 text-xs text-muted">
                          {turn.model} · 输出 {turn.completionTokens} tokens
                        </p>
                      )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 px-4 pb-4 pb-safe">
        {error && (
          <div
            className="mx-auto mb-3 flex max-w-3xl items-center justify-between gap-3 text-sm text-red-600"
            role="alert"
          >
            <span>{error}</span>
            <button
              className="shrink-0 text-accent"
              onClick={() => {
                setError("");
                void load();
              }}
            >
              重新连接
            </button>
          </div>
        )}
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            className="max-h-40 min-h-12 flex-1 resize-y bg-transparent px-2 py-3 text-sm outline-none"
            rows={2}
            maxLength={8000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="输入消息…"
            aria-label="输入消息"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send(draft);
              }
            }}
          />
          <button
            className="mb-1 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white disabled:cursor-not-allowed disabled:opacity-40"
            type="submit"
            disabled={!loaded || sending || pending || !draft.trim()}
            aria-label="发送"
          >
            ↑
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted">
          {pending || sending
            ? "回复完成后可继续发送"
            : "Enter 发送 · Shift + Enter 换行 · 对话自动保存"}
        </p>
      </div>
    </div>
  );
}
