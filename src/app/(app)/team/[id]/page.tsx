import { DotDetail } from "@/components/dot-detail";

export default async function DotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DotDetail id={id} />;
}
