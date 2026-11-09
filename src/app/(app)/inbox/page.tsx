import { PageBody } from "@/components/shell";

export default function InboxPage() {
  return (
    <PageBody title="需要你处理">
      <p className="text-sm text-muted">等你批准或核对的事项会集中在这里。</p>
      <div className="mt-4 rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
        目前没有待处理事项。审批卡片从第 8 天开始出现。
      </div>
    </PageBody>
  );
}
