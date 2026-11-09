"use client";

import Link from "next/link";
import { DotFace } from "@/components/shell";

export function MobileHome() {
  return (
    <div className="flex h-full flex-col lg:hidden">
      <header className="flex items-center gap-2 px-4 py-4 font-semibold">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-ink text-xs text-panel">OD</span>
        OpenDot
      </header>
      <div className="px-4">
        <div className="kicker">主智能体</div>
        <Link href="/c/xiaodian" className="mt-2 flex items-center gap-3 rounded-2xl px-2 py-3">
          <span className="scale-125"><DotFace /></span>
          <span>
            <span className="block font-medium">小点</span>
            <span className="block text-xs text-muted">你的个人协调员</span>
          </span>
        </Link>
        <div className="kicker mt-6">自定义智能体</div>
        <p className="mt-2 text-sm text-muted">第 3 天可以在这里新建 Dot。</p>
      </div>
    </div>
  );
}

export function ChatStage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link href="/" className="text-muted lg:hidden">←</Link>
        <DotFace />
        <div>
          <div className="font-medium">小点</div>
          <div className="text-xs text-muted">你的个人协调员 · 默认模型</div>
        </div>
        <span className="ml-auto hidden items-center gap-1 text-xs text-muted sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          已连接服务端
        </span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <span className="mb-4 scale-150"><DotFace /></span>
        <h1 className="text-xl font-medium">今天需要我帮你处理什么？</h1>
        <p className="mt-2 max-w-md text-sm text-muted">我是小点。从下方交代一项工作。</p>
        <p className="mt-4 max-w-md text-xs text-muted">对话会从第 2 天开始保存。今天先把桌面侧栏和手机底栏固定下来。</p>
      </div>
      <div className="px-4 pb-4">
        <form className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-line bg-panel p-2">
          <input className="h-11 flex-1 bg-transparent px-2 outline-none" placeholder="输入消息…" aria-label="输入消息" disabled />
          <button className="grid h-10 w-10 place-items-center rounded-full bg-accent text-white" type="button" disabled aria-label="发送">↑</button>
        </form>
      </div>
    </div>
  );
}
