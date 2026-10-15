import { requireChatGPTUser } from "./chatgpt-auth";
import Notebook from "@/components/notebook";
export const dynamic = "force-dynamic";
export default async function Home() {
  await requireChatGPTUser("/");
  return <Notebook />;
}
