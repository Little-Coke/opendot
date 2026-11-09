import Link from "next/link";
import { ChatStage } from "@/components/welcome";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== "xiaodian") {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p>还没有这个会话。</p>
          <Link className="mt-3 inline-block text-accent" href="/">回小点</Link>
        </div>
      </div>
    );
  }
  return <ChatStage />;
}
