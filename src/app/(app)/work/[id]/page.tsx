import { WorkDetail } from "@/components/work-detail";

export default async function WorkGoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkDetail key={id} id={id} />;
}
