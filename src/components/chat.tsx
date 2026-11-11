"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUp, Settings2 } from "lucide-react";
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
  const readsInFlight = useRef(0);
  const pending = turns.some((turn) => turn.status === "pending");
  const load = useCallback(async (signal?: AbortSignal) => {
    if (activeRequest.current) return;
    const version = ++readVersion.current;
    readsInFlight.current++;
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
      setError("");
    } catch (failure) {
      if (signal?.aborted || version !== readVersion.current) return;
      setOnline(false);
      setError(failure instanceof Error ? failure.message : "无法连接服务端");
    } finally {
      readsInFlight.current--;
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    const version = readVersion;
    return () => {
      abort.abort();
      version.current++;
      activeRequest.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    const reconnect = () => void load();
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    const interval =
      !sending && (pending || !online)
        ? setInterval(
            () => {
              if (readsInFlight.current === 0) reconnect();
            },
            pending ? 2000 : 5000,
          )
        : undefined;
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
    };
  }, [pending, sending, online, load]);
  useEffect(() => {
    if (pinned.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [turns]);

  async function send(content: string, id = requestId(), retry = false) {
    if (
      !loaded ||
      !online ||
      activeRequest.current ||
      sending ||
      pending ||
      !content.trim()
    )
      return;
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
      activeRequest.current = null;
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
    <div className="chat-stage">
      <header className="chat-header">
        <Link
          href="/"
          className="icon-button lg:hidden"
          aria-label="返回会话列表"
        >
          <ArrowLeft size={20} />
        </Link>
        <DotFace />
        <div className="min-w-0">
          <div className="font-medium">小点</div>
          <div className="truncate text-xs text-muted">
            {settings?.hasKey ? settings.model : "你的个人协调员 · 演示模式"}
          </div>
        </div>
        <span className="connection-status" data-online={online} role="status">
          <span className="connection-dot" />
          {online ? "已连接服务端" : error ? "连接已断开" : "正在连接…"}
        </span>
        <Link className="icon-button" href="/settings" aria-label="模型设置">
          <Settings2 size={19} />
        </Link>
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
        className="chat-timeline"
        aria-label="对话消息"
      >
        {!loaded ? (
          <p className="py-16 text-center text-sm text-muted" role="status">
            {error ? "等待重新连接，消息将在连接恢复后加载" : "正在加载对话…"}
          </p>
        ) : turns.length === 0 ? (
          <div className="chat-welcome">
            <span className="welcome-dot">
              <DotFace />
            </span>
            <p className="welcome-intro">你好，我是小点</p>
            <h1>今天，我们从哪里开始？</h1>
            <p className="mt-3 text-sm text-muted">
              一个想法、一个问题，或者一件想完成的事。
            </p>
          </div>
        ) : (
          <div className="message-list">
            {turns.map((turn, index) => (
              <article key={turn.id} className="message-turn">
                <div className="flex justify-end">
                  <div className="user-message">{turn.content}</div>
                </div>
                <div className="assistant-message">
                  <span className="mt-1 shrink-0">
                    <DotFace />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-xs font-medium text-muted">
                      小点{turn.model === "演示模式" ? " · 演示回复" : ""}
                    </div>
                    <div className="assistant-reply">
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
                            disabled={!online || sending || pending}
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
      <div className="composer-dock pb-safe">
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
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            className="max-h-40 min-h-12 min-w-0 flex-1 resize-y rounded-xl bg-transparent px-2 py-3 text-base outline-none sm:text-sm"
            rows={2}
            maxLength={8000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="和小点说点什么…"
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
            className="send-button"
            type="submit"
            disabled={!loaded || !online || sending || pending || !draft.trim()}
            aria-label="发送"
          >
            <ArrowUp size={21} strokeWidth={2.2} />
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
