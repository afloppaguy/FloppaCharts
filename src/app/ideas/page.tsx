import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ChatView, GradeBadge } from "@/components/chat-view";
import { currentView } from "@/components/game-table";
import { ViewToggle } from "@/components/quick-actions";
import { PageHeader } from "@/components/page-parts";
import { getApiKey } from "@/lib/ai";
import { listChats } from "@/lib/chat";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const [chats, key, sp, view] = await Promise.all([listChats(), getApiKey(), searchParams, currentView()]);

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
        <div className="flex items-center gap-2">
          <ViewToggle view={view} />
          <Link href="/ideas?new=1" className={buttonVariants({ size: "sm" })}>
            <Plus /> New idea
          </Link>
        </div>
      </PageHeader>
      {view === "grid" && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {chats.map((c) => (
            <Link key={c.id} href={`/ideas/${c.id}`} className="flex min-h-36 flex-col rounded-2xl bg-muted/30 p-4 transition-colors hover:bg-muted/60">
              <div className="flex items-start justify-between gap-2">
                {c.grade ? <GradeBadge grade={c.grade} size="lg" /> : <span className="flex h-12 items-center text-xs text-muted-foreground/60">Not graded</span>}
                <span className="text-xs text-muted-foreground">{ago(c.updated_at)}</span>
              </div>
              <div className="mt-3 line-clamp-2 text-sm font-medium">{c.title}</div>
              {c.grade_reason && <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.grade_reason}</div>}
            </Link>
          ))}
        </div>
      )}
      <div className={view === "grid" ? "hidden" : "grid gap-0.5"}>
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
