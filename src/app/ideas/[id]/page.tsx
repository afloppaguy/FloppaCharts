import { notFound } from "next/navigation";
import { ChatView } from "@/components/chat-view";
import { getBudget, MODELS } from "@/lib/ai";
import { getChat, getChatTurns } from "@/lib/chat";

export const dynamic = "force-dynamic";

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const chat = Number.isFinite(id) ? await getChat(id) : null;
  if (!chat) notFound();
  const [turns, budget] = await Promise.all([getChatTurns(id), getBudget()]);
  return (
    <ChatView
      key={id}
      chatId={id}
      title={chat.title}
      initialTurns={turns}
      initialCard={chat.grade ? { grade: chat.grade, name: chat.idea_name ?? chat.title, pitch: chat.pitch } : null}
      initialReason={chat.grade_reason}
      models={[...MODELS]}
      initialModel={budget.model}
      budget={budget}
      initialChatCost={Number(chat.cost_usd)}
    />
  );
}
