import { ChatStage, MobileHome } from "@/components/welcome";

export default function HomePage() {
  return (
    <>
      <MobileHome />
      <div className="hidden h-full lg:block">
        <ChatStage />
      </div>
    </>
  );
}
