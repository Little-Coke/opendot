"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DotMark } from "@/components/dot-mark";
import { PageBody } from "@/components/shell";
import {
  MAIN_DOT_ID,
  type CustomDot,
  type DotPanel,
  type DotTabId,
  roleLabel,
} from "@/lib/dot-profile";

type DetailPayload = {
  dot: CustomDot;
  defaultModel: string;
  recent: string;
  tabs: DotPanel[];
};

export function DotDetail({ id }: { id: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<DetailPayload | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<DotTabId>("chat");
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (id === MAIN_DOT_ID) return;
    let cancelled = false;
    async function load() {
      setError("");
      try {
        const response = await fetch(`/api/dots/${id}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "读取 Dot 失败");
        if (!cancelled) setPayload(result);
      } catch (failure) {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : "无法连接服务端");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (id === MAIN_DOT_ID) {
    return (
      <PageBody kicker="MY TEAM" title="小点">
        <p className="text-sm leading-7">小点是主 Dot，名字和对话都保持原样。</p>
        <Link className="mt-3 inline-block text-sm text-accent" href="/c/xiaodian">开始对话</Link>
        <Link className="mt-3 ml-4 inline-block text-sm text-muted" href="/team">返回我的 Dot</Link>
      </PageBody>
    );
  }

  const current = payload?.tabs.find((item) => item.id === tab) ?? payload?.tabs[0];

  return (
    <PageBody kicker="MY TEAM" title={payload?.dot.name ?? "Dot"}>
      <Link className="mb-4 inline-block text-sm text-muted" href="/team">← 我的 Dot</Link>
      {!payload && !error ? <p className="text-sm text-muted">正在读取…</p> : null}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}{" "}
          <Link className="underline" href="/team">返回我的 Dot</Link>
        </p>
      ) : null}
      {payload && current ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            <DotMark shape={payload.dot.shape} color={payload.dot.color} size={40} />
            <div className="min-w-0">
              <div className="text-sm">角色：{roleLabel(payload.dot.role)}</div>
              <div className="text-xs text-muted">{payload.defaultModel}</div>
              <div className="text-xs text-muted">最近对话：{payload.recent}</div>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto text-sm" role="tablist" aria-label="Dot 详情">
            {payload.tabs.map((item) => (
              <button
                key={item.id}
                className={`shrink-0 rounded-full px-3 py-1 ${item.id === current.id ? "bg-accent text-white" : "border border-line bg-panel text-muted"}`}
                type="button"
                role="tab"
                aria-selected={item.id === current.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-line bg-panel px-4 py-4 text-sm leading-7" role="tabpanel">
            <p>{current.body}</p>
            {current.id === "chat" ? (
              <Link className="mt-3 inline-block text-accent" href="/c/xiaodian">先和小点对话</Link>
            ) : null}
            {current.id === "work" ? (
              <Link className="mt-3 inline-block text-accent" href="/work">打开我的工作</Link>
            ) : null}
          </div>
          <div className="mt-8 border-t border-line pt-4">
            <button
              className="text-sm text-muted underline disabled:opacity-60"
              type="button"
              disabled={removing}
              onClick={async () => {
                if (!window.confirm(`删除「${payload.dot.name}」？小点的对话记录不会受影响。`)) return;
                setRemoving(true);
                setError("");
                try {
                  const response = await fetch(`/api/dots/${id}`, { method: "DELETE" });
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error || "删除失败");
                  router.push("/team");
                  router.refresh();
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : "删除失败，请重试");
                  setRemoving(false);
                }
              }}
            >
              {removing ? "正在删除…" : "删除这个 Dot"}
            </button>
            <p className="mt-1 text-xs text-muted">只删除这份自定义资料，不会改动小点的对话。</p>
          </div>
        </>
      ) : null}
    </PageBody>
  );
}
