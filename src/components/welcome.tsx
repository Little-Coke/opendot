"use client";
import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { DotFace } from "@/components/shell";

export function MobileHome() {
  return (
    <main className="mobile-home lg:hidden">
      <header className="mobile-brand">
        <DotFace />
        <span>OpenDot</span>
      </header>
      <div className="mobile-home-heading">
        <p>你的个人空间</p>
        <h1>从一句话开始。</h1>
      </div>
      <Link href="/c/xiaodian" className="assistant-card">
        <span className="large-dot">
          <DotFace />
        </span>
        <div>
          <h2>小点</h2>
          <p>聊想法，写内容，一起理清思路。</p>
        </div>
        <ArrowUpRight size={22} />
        <span className="assistant-card-action">
          继续对话
          <ChevronRight size={18} />
        </span>
      </Link>
      <Link href="/team" className="mobile-team-link">
        查看我的 Dot
        <ChevronRight size={17} />
      </Link>
    </main>
  );
}
export { ChatStage } from "./chat";
