import { PageBody } from "@/components/shell";

const ITEMS = [
  ["个人资料", "显示名称和头像。第 11 天。"],
  ["常规", "明暗模式、配色和字体。第 11 天。"],
  ["模型提供商", "OpenAI 兼容接口。留空时保持演示模式。第 12 天。"],
  ["执行与容量", "运行时长、日志和并发。随委托一起做。"],
];

export default function SettingsPage() {
  return (
    <PageBody title="设置">
      <p className="mb-4 text-sm text-muted">当前是第 1 天的骨架。外观和模型还没有接上，打开即可使用。</p>
      <div className="grid max-w-xl gap-2">
        {ITEMS.map(([title, body]) => (
          <div key={title} className="card px-4 py-3">
            <div className="font-medium">{title}</div>
            <div className="text-sm text-muted">{body}</div>
          </div>
        ))}
      </div>
    </PageBody>
  );
}
