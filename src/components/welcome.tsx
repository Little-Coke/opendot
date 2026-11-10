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
        <Link href="/team" className="mt-2 inline-block text-sm text-accent">在团队页新建 Dot</Link>
      </div>
    </div>
  );
}

export { ChatStage } from "./chat";
