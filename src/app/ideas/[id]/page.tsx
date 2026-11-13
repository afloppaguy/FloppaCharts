import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { deleteChatAction } from "@/app/actions";
import { ChatView } from "@/components/chat-view";
import { getChat, getChatTurns } from "@/lib/chat";

export const dynamic = "force-dynamic";

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const chat = Number.isFinite(id) ? await getChat(id) : null;
  if (!chat) notFound();
  const turns = await getChatTurns(id);
  return (
    <div className="relative">
      <div className="absolute top-0 left-0 z-10 flex items-center gap-1">
        <Link href="/ideas" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All ideas
        </Link>
        <form action={deleteChatAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" aria-label="Delete this conversation" title="Delete this conversation" className="inline-flex size-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-rose-300">
            <Trash2 className="size-3.5" />
          </button>
        </form>
      </div>
      <ChatView key={id} chatId={id} initialTurns={turns} initialGrade={chat.grade} initialReason={chat.grade_reason} />
    </div>
  );
}
