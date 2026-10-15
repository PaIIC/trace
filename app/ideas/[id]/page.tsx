import { requireChatGPTUser } from "@/app/chatgpt-auth";
import Notebook from "@/components/notebook";
export const dynamic = "force-dynamic";
export default async function IdeaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireChatGPTUser(`/ideas/${encodeURIComponent(id)}`);
  return <Notebook initialIdeaId={id} />;
}
