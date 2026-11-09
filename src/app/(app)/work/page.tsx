import { PageBody } from "@/components/shell";

const TABS = ["全部", "进行中", "需要你处理", "已完成", "计划与例行"];

export default function WorkPage() {
  return (
    <PageBody title="我的工作">
      <p className="text-sm text-muted">持续推进的目标。需要你处理的事项与成果。</p>
      <div className="mt-4 flex gap-2 overflow-x-auto text-sm">
        {TABS.map((tab, index) => (
          <span key={tab} className={`rounded-full px-3 py-1 ${index === 0 ? "bg-accent text-white" : "border border-line bg-panel text-muted"}`}>{tab}</span>
        ))}
      </div>
      <section className="mt-6">
        <h2 className="font-medium">正在进行</h2>
        <p className="mt-1 text-sm text-muted">交代一项工作后，进度会显示在这里。</p>
        <div className="mt-3 rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          还没有委托。第 6 天可以写下目标和完成条件。
        </div>
      </section>
      <section className="mt-6">
        <h2 className="font-medium">需要你处理 0</h2>
        <p className="mt-1 text-sm text-muted">目前没有待处理事项。</p>
      </section>
    </PageBody>
  );
}
