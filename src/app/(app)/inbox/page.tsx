import Link from "next/link";
import { Inbox } from "lucide-react";
import { PageBody } from "@/components/shell";
export default function InboxPage() {
  return (
    <PageBody title="需要你处理">
      <p className="page-description">集中查看需要你批准或核对的事项。</p>
      <section className="empty-state">
        <span className="empty-icon">
          <Inbox size={30} strokeWidth={1.5} />
        </span>
        <h2>暂时没有待处理事项</h2>
        <p>审批功能正在开发中。你可以继续与小点对话。</p>
        <Link className="secondary-button" href="/c/xiaodian">
          返回对话
        </Link>
      </section>
    </PageBody>
  );
}
