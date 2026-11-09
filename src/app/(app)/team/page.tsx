import Link from "next/link";
import { DotFace, PageBody } from "@/components/shell";

export default function TeamPage() {
  return (
    <PageBody kicker="MY TEAM" title="我的 Dot">
      <p className="mb-4 text-sm text-muted">自定义智能体会在第 3 天从这里新建。现在只有主 Dot。</p>
      <article className="flex items-center gap-3 border-b border-line py-4">
        <DotFace />
        <div className="min-w-0 flex-1">
          <div className="font-medium">小点</div>
          <div className="text-xs text-muted">你的个人协调员 · 默认模型</div>
          <div className="text-xs text-muted">技能未配置 · 外部连接未配置</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">暂无团队任务</div>
          <Link className="mt-1 inline-block text-sm text-accent" href="/c/xiaodian">开始对话</Link>
        </div>
      </article>
    </PageBody>
  );
}
