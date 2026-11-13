import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ChatView, GradeBadge } from "@/components/chat-view";
import { PageHeader } from "@/components/page-parts";
import { getApiKey } from "@/lib/ai";
import { listChats } from "@/lib/chat";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const [chats, key, sp] = await Promise.all([listChats(), getApiKey(), searchParams]);

  if (!key) {
    return (
      <div className="mx-auto grid max-w-3xl gap-5">
        <PageHeader title="Ideas" subtitle="Pitch a game idea and get it graded against live data." />
        <p className="rounded-xl bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
          The idea chat needs a Claude API key.{" "}
          <Link href="/settings" className="text-foreground underline underline-offset-4">
            Add one in Settings
          </Link>{" "}
          to turn it on.
        </p>
      </div>
    );
  }

  if (sp.new || chats.length === 0) return <ChatView chatId={null} initialTurns={[]} initialGrade={null} initialReason={null} />;

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <PageHeader title="Ideas" subtitle={`${chats.length} ${chats.length === 1 ? "conversation" : "conversations"}`}>
        <Link href="/ideas?new=1" className={buttonVariants({ size: "sm" })}>
          <Plus /> New idea
        </Link>
      </PageHeader>
      <div className="grid gap-0.5">
        {chats.map((c) => (
          <Link key={c.id} href={`/ideas/${c.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50">
            <span className="flex w-10 justify-center">{c.grade ? <GradeBadge grade={c.grade} /> : <span className="text-xs text-muted-foreground/50">–</span>}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{c.title}</span>
              {c.grade_reason && <span className="block truncate text-xs text-muted-foreground">{c.grade_reason}</span>}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{ago(c.updated_at)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
