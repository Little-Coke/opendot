"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BODY_MAX,
  MEMORY_KINDS,
  MEMORY_SCOPES,
  TITLE_MAX,
  WORKSPACE_MAX,
  memoryKindLabel,
  type MemoryItem,
  type MemoryKind,
  type MemoryScope,
  type MemoryVersion,
} from "@/lib/memory-profile";
import styles from "./workspace-memory.module.css";

type Filters = {
  q: string;
  kind: MemoryKind | "";
  scope: MemoryScope | "";
  forWorkspace: string;
};

type EditDraft = {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
};

const initialFilters: Filters = { q: "", kind: "", scope: "", forWorkspace: "" };

const kindClass: Record<MemoryKind, string> = {
  fact: styles.fact,
  decision: styles.decision,
  experience: styles.experience,
  follow_up: styles.follow,
};

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

async function readBody(response: Response) {
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result as Record<string, unknown>;
}

function isMemory(value: unknown): value is MemoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MemoryItem>;
  return typeof item.id === "string" && typeof item.title === "string" && typeof item.body === "string";
}

export function WorkspaceMemory() {
  const [mem0Enabled, setMem0Enabled] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [kind, setKind] = useState<MemoryKind>("fact");
  const [scope, setScope] = useState<MemoryScope>("workspace");
  const [home, setHome] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [history, setHistory] = useState<Record<string, MemoryVersion[]>>({});
  const [confirming, setConfirming] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const busyRef = useRef(false);

  const load = useCallback(async (next: Filters) => {
    const current = ++requestId.current;
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.kind) params.set("kind", next.kind);
    if (next.scope) params.set("scope", next.scope);
    if (next.forWorkspace) params.set("forWorkspace", next.forWorkspace);
    const response = await fetch(`/api/memory?${params.toString()}`, { cache: "no-store" });
    const result = await readBody(response);
    if (current !== requestId.current) return;
    setMem0Enabled(result.mem0Enabled === true);
    setMemories(Array.isArray(result.memories) ? result.memories.filter(isMemory) : []);
    setError("");
  }, []);

  useEffect(() => {
    void load(filters).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "无法连接服务端");
    });
  }, [filters, load]);

  async function run(task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败，请重试");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function applyFilters(next: Filters) {
    setFilters(next);
  }

  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-labelledby="memory-settings">
        <h2 id="memory-settings" className={styles.title}>
          工作区记忆
        </h2>
        <p className={styles.help}>
          记下事实、决策、经验和待跟进。它们写在这台机器的记忆库里。忘记一条记忆不会删除聊天记录。个人记忆要在其他工作区使用，需要逐条打开授权。
        </p>
        <div className={styles.panel}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={mem0Enabled}
              disabled={busy || memories === null}
              onChange={(event) => {
                const enabled = event.target.checked;
                void run(async () => {
                  const previous = mem0Enabled;
                  setMem0Enabled(enabled);
                  try {
                    const response = await fetch("/api/memory", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "mem0", enabled }),
                    });
                    const result = await readBody(response);
                    setMem0Enabled(result.mem0Enabled === true);
                    setMessage(
                      result.mem0Enabled === true ? "已打开 Mem0 开关。没有连接 Mem0。" : "已关闭 Mem0 开关。",
                    );
                  } catch (failure) {
                    setMem0Enabled(previous);
                    throw failure;
                  }
                });
              }}
            />
            Mem0 {mem0Enabled ? "已打开" : "已关闭"}
          </label>
          <p className={styles.note}>默认关闭。这个开关只记在本机，不会连接 Mem0，也不会把记忆发出去。</p>
        </div>

        <form
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const response = await fetch("/api/memory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "create",
                  kind,
                  scope,
                  ...(scope === "workspace" ? { workspace: home } : {}),
                  title,
                  body: content,
                }),
              });
              const result = await readBody(response);
              const created = isMemory(result.memory) ? result.memory : null;
              setTitle("");
              setContent("");
              if (scope === "workspace") setHome("");
              setMessage(created ? `已记下「${created.title}」。` : "已记下这条记忆。");
              await load(filters);
            });
          }}
        >
          <h3 className="font-medium">新建记忆</h3>
          <div className={styles.choices} role="radiogroup" aria-label="记忆类型">
            {MEMORY_KINDS.map((item) => (
              <label key={item.id} className={styles.choice}>
                <input
                  type="radio"
                  name="memory-kind"
                  checked={kind === item.id}
                  onChange={() => setKind(item.id)}
                />
                {item.label}
              </label>
            ))}
          </div>
          <div className={styles.choices} role="radiogroup" aria-label="记忆范围">
            {MEMORY_SCOPES.map((item) => (
              <label key={item.id} className={styles.choice}>
                <input
                  type="radio"
                  name="memory-scope"
                  checked={scope === item.id}
                  onChange={() => setScope(item.id)}
                />
                {item.label}
              </label>
            ))}
          </div>
          {scope === "workspace" ? (
            <label className="block text-sm">
              工作区
              <input
                className="field mt-2"
                value={home}
                maxLength={WORKSPACE_MAX}
                autoComplete="off"
                placeholder="例如：产品"
                onChange={(event) => setHome(event.target.value)}
              />
            </label>
          ) : (
            <p className={styles.note}>个人记忆先只属于你。要给其他工作区用，创建后再逐条授权。</p>
          )}
          <label className="block text-sm">
            标题
            <input
              className="field mt-2"
              value={title}
              maxLength={TITLE_MAX}
              autoComplete="off"
              placeholder="例如：周五例会改到下午三点"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            内容
            <textarea
              className={`${styles.textarea} mt-2`}
              value={content}
              maxLength={BODY_MAX}
              placeholder="记下具体内容，可以换行。"
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <button className="primary-button w-full sm:w-auto" type="submit" disabled={busy}>
            {busy ? "正在保存…" : "记下"}
          </button>
        </form>

        <form
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters({
              q: query.trim(),
              kind: filters.kind,
              scope: filters.scope,
              forWorkspace: workspace.trim(),
            });
          }}
        >
          <label className="block text-sm">
            搜索
            <input
              className="field mt-2"
              value={query}
              maxLength={80}
              autoComplete="off"
              placeholder="搜索标题或内容"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            查看某个工作区可用的记忆
            <input
              className="field mt-2"
              value={workspace}
              maxLength={WORKSPACE_MAX}
              autoComplete="off"
              placeholder="例如：产品。留空则查看全部。"
              onChange={(event) => setWorkspace(event.target.value)}
            />
          </label>
          <div className={styles.filters} role="group" aria-label="按类型筛选">
            <button
              className={styles.filter}
              type="button"
              aria-pressed={filters.kind === ""}
              onClick={() => applyFilters({ ...filters, kind: "" })}
            >
              全部类型
            </button>
            {MEMORY_KINDS.map((item) => (
              <button
                key={item.id}
                className={styles.filter}
                type="button"
                aria-pressed={filters.kind === item.id}
                onClick={() => applyFilters({ ...filters, kind: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className={styles.filters} role="group" aria-label="按范围筛选">
            <button
              className={styles.filter}
              type="button"
              aria-pressed={filters.scope === ""}
              onClick={() => applyFilters({ ...filters, scope: "" })}
            >
              全部范围
            </button>
            {MEMORY_SCOPES.map((item) => (
              <button
                key={item.id}
                className={styles.filter}
                type="button"
                aria-pressed={filters.scope === item.id}
                onClick={() => applyFilters({ ...filters, scope: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className={styles.actions}>
            <button className="secondary-button" type="submit">
              搜索
            </button>
            {filters.q || filters.forWorkspace || filters.kind || filters.scope ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setQuery("");
                  setWorkspace("");
                  applyFilters(initialFilters);
                }}
              >
                查看全部记忆
              </button>
            ) : null}
          </div>
          <p className={styles.note}>
            {filters.forWorkspace
              ? `正在查看「${filters.forWorkspace}」里可用的记忆：该工作区自己的，以及已经逐条授权的个人记忆。`
              : "填写工作区后，未授权的个人记忆不会出现在那个工作区里。"}
          </p>
        </form>

        {message ? (
          <p className={`${styles.message} ${styles.ok}`} role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className={`${styles.message} ${styles.bad}`} role="alert">
            {error}
            {memories === null ? (
              <>
                {" "}
                <button
                  className="underline"
                  type="button"
                  onClick={() => {
                    void load(filters).catch((failure: unknown) => {
                      setError(failure instanceof Error ? failure.message : "无法连接服务端");
                    });
                  }}
                >
                  重试
                </button>
              </>
            ) : null}
          </p>
        ) : null}

        {memories === null && !error ? <p className={styles.note}>正在读取记忆…</p> : null}
        {memories && memories.length === 0 ? (
          <div className={styles.empty}>
            {filters.q || filters.forWorkspace || filters.kind || filters.scope
              ? "没有符合条件的记忆。未授权的个人记忆不会出现在其他工作区。"
              : "还没有记忆。可以记下事实、决策、经验或待跟进，它们会留在这台机器上。"}
          </div>
        ) : null}
        {memories && memories.length > 0 ? (
          <div className={styles.list}>
            <p className={styles.meta}>{memories.length} 条</p>
            {memories.map((item) => {
              const versions = history[item.id];
              const isEditing = editing?.id === item.id;
              return (
                <article key={item.id} className={styles.card}>
                  <div className={styles.head}>
                    <span className={`${styles.badge} ${kindClass[item.kind]}`}>{memoryKindLabel(item.kind)}</span>
                    <span className={`${styles.badge} ${styles.plain}`}>
                      {item.scope === "personal" ? "个人记忆" : item.workspace}
                    </span>
                    <span className={styles.meta}>版本 {item.version}</span>
                  </div>
                  <h3 className={styles.name}>{item.title}</h3>
                  <p className={styles.body}>{item.body}</p>
                  {item.scope === "personal" ? (
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={item.crossWorkspace}
                        disabled={busy}
                        onChange={(event) => {
                          const crossWorkspace = event.target.checked;
                          void run(async () => {
                            const response = await fetch("/api/memory", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "authorize", id: item.id, crossWorkspace }),
                            });
                            await readBody(response);
                            setMessage(
                              crossWorkspace
                                ? `已允许「${item.title}」跨工作区使用。`
                                : `已收回「${item.title}」的跨工作区授权。`,
                            );
                            await load(filters);
                          });
                        }}
                      />
                      允许跨工作区使用
                    </label>
                  ) : (
                    <p className={styles.note}>只在「{item.workspace}」使用。工作区记忆不能授权到其他工作区。</p>
                  )}
                  {item.scope === "personal" ? (
                    <p className={styles.note}>
                      {item.crossWorkspace
                        ? "已授权。其他工作区查看可用记忆时会带上这一条。"
                        : "尚未授权。其他工作区看不到这条个人记忆。"}
                    </p>
                  ) : null}
                  <div className={styles.actions}>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setConfirming("");
                        setEditing(
                          isEditing ? null : { id: item.id, kind: item.kind, title: item.title, body: item.body },
                        );
                      }}
                    >
                      {isEditing ? "取消编辑" : "编辑"}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (versions) {
                          setHistory((current) => {
                            const next = { ...current };
                            delete next[item.id];
                            return next;
                          });
                          return;
                        }
                        void run(async () => {
                          const response = await fetch(`/api/memory?id=${item.id}`, { cache: "no-store" });
                          const result = await readBody(response);
                          const rows = Array.isArray(result.versions)
                            ? result.versions.filter(
                                (version): version is MemoryVersion =>
                                  !!version &&
                                  typeof version === "object" &&
                                  typeof (version as MemoryVersion).version === "number" &&
                                  typeof (version as MemoryVersion).title === "string",
                              )
                            : [];
                          setHistory((current) => ({ ...current, [item.id]: rows }));
                        });
                      }}
                    >
                      {versions ? "收起版本" : "查看版本"}
                    </button>
                    {confirming === item.id ? (
                      <>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void run(async () => {
                              const response = await fetch("/api/memory", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "forget", id: item.id }),
                              });
                              await readBody(response);
                              setConfirming("");
                              setEditing((current) => (current?.id === item.id ? null : current));
                              setHistory((current) => {
                                const next = { ...current };
                                delete next[item.id];
                                return next;
                              });
                              setMessage(`已忘记「${item.title}」。聊天记录还在。`);
                              await load(filters);
                            });
                          }}
                        >
                          确认忘记
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => setConfirming("")}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditing((current) => (current?.id === item.id ? null : current));
                          setConfirming(item.id);
                        }}
                      >
                        忘记
                      </button>
                    )}
                  </div>
                  {confirming === item.id ? (
                    <p className={styles.note}>忘记后，这条记忆不再参与搜索。聊天记录会保留。</p>
                  ) : null}
                  {isEditing && editing ? (
                    <form
                      className={styles.versions}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const draft = editing;
                        void run(async () => {
                          const response = await fetch("/api/memory", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              action: "revise",
                              id: draft.id,
                              kind: draft.kind,
                              title: draft.title,
                              body: draft.body,
                            }),
                          });
                          const result = await readBody(response);
                          const saved = isMemory(result.memory) ? result.memory : null;
                          if (Array.isArray(result.versions)) {
                            setHistory((current) => ({
                              ...current,
                              [draft.id]: result.versions as MemoryVersion[],
                            }));
                          }
                          setEditing(null);
                          setMessage(saved ? `已保存「${saved.title}」的版本 ${saved.version}。` : "已生成新版本。");
                          await load(filters);
                        });
                      }}
                    >
                      <div className={styles.choices} role="radiogroup" aria-label="修改类型">
                        {MEMORY_KINDS.map((option) => (
                          <label key={option.id} className={styles.choice}>
                            <input
                              type="radio"
                              name={`edit-kind-${item.id}`}
                              checked={editing.kind === option.id}
                              onChange={() => setEditing({ ...editing, kind: option.id })}
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                      <label className="block text-sm">
                        标题
                        <input
                          className="field mt-2"
                          value={editing.title}
                          maxLength={TITLE_MAX}
                          onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                        />
                      </label>
                      <label className="block text-sm">
                        内容
                        <textarea
                          className={`${styles.textarea} mt-2`}
                          value={editing.body}
                          maxLength={BODY_MAX}
                          onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                        />
                      </label>
                      <button className="primary-button w-full sm:w-auto" type="submit" disabled={busy}>
                        保存为新版本
                      </button>
                    </form>
                  ) : null}
                  {versions ? (
                    <div className={styles.versions}>
                      {versions.map((version) => (
                        <div key={version.version} className={styles.version}>
                          <p className={styles.meta}>
                            版本 {version.version}
                            {version.version === item.version ? " · 当前" : ""} · {memoryKindLabel(version.kind)} ·{" "}
                            {formatTime(version.createdAt)}
                          </p>
                          <p className={styles.name}>{version.title}</p>
                          <p className={styles.body}>{version.body}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
