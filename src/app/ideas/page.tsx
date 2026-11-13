import Link from "next/link";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { deleteChatAction } from "@/app/actions";
import { buttonVariants } from "@/components/ui/button";
import { ChatView, GradeBadge } from "@/components/chat-view";
import { currentView } from "@/components/game-table";
import { PageHeader } from "@/components/page-parts";
import { ViewToggle } from "@/components/quick-actions";
import { getApiKey, getBudget, modelLabel, MODELS } from "@/lib/ai";
import { listChats, type ChatRow } from "@/lib/chat";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

const cost = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${Number(n).toFixed(2)}`);

function DeleteButton({ id, className }: { id: number; className?: string }) {
  return (
    <form action={deleteChatAction} className={className}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" aria-label="Delete this conversation" title="Delete this conversation" className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-rose-300">
        <Trash2 className="size-3.5" />
      </button>
    </form>
  );
}

function Meta({ c }: { c: ChatRow }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <MessageSquare className="size-3" /> {c.messages}
      </span>
      <span>·</span>
      <span className="tabular-nums">{cost(c.cost_usd)}</span>
      {c.model && (
        <>
          <span>·</span>
          <span>{modelLabel(c.model)}</span>
        </>
      )}
      <span>·</span>
      <span>{ago(c.updated_at)}</span>
    </span>
  );
}

export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const [chats, key, sp, view, budget] = await Promise.all([listChats(), getApiKey(), searchParams, currentView(), getBudget()]);

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

  if (sp.new || chats.length === 0) {
    return <ChatView chatId={null} title={null} initialTurns={[]} initialGrade={null} initialReason={null} models={[...MODELS]} initialModel={budget.model} budget={budget} initialChatCost={0} />;
  }

  const graded = chats.filter((c) => c.grade).length;
  const total = chats.reduce((sum, c) => sum + Number(c.cost_usd), 0);

  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <PageHeader title="Ideas" subtitle={`${chats.length} ${chats.length === 1 ? "conversation" : "conversations"} · ${graded} graded · ${cost(total)} spent · $${budget.remaining.toFixed(2)} left this month`}>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} />
          <Link href="/ideas?new=1" className={buttonVariants({ size: "sm" })}>
            <Plus /> New idea
          </Link>
        </div>
      </PageHeader>

      {view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
          {chats.map((c) => (
            <div key={c.id} className="group relative flex min-h-44 flex-col rounded-2xl bg-muted/30 p-4 transition-colors hover:bg-muted/60">
              <div className="flex items-start justify-between gap-2">
                {c.grade ? <GradeBadge grade={c.grade} size="lg" /> : <span className="flex h-11 items-center text-xs text-muted-foreground/60">Not graded</span>}
                <DeleteButton id={c.id} className="relative z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" />
              </div>
              <Link href={`/ideas/${c.id}`} className="mt-3 line-clamp-2 text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
                {c.title}
              </Link>
              <p className="mt-1 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">{c.summary ?? c.grade_reason ?? "No summary yet."}</p>
              <div className="mt-3">
                <Meta c={c} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-0.5">
          {chats.map((c) => (
            <div key={c.id} className="group relative flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50">
              <span className="flex w-10 shrink-0 justify-center">{c.grade ? <GradeBadge grade={c.grade} /> : <span className="text-xs text-muted-foreground/50">–</span>}</span>
              <span className="min-w-0 flex-1">
                <Link href={`/ideas/${c.id}`} className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">
                  {c.title}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">{c.summary ?? c.grade_reason ?? "No summary yet."}</span>
              </span>
              <span className="hidden shrink-0 md:block">
                <Meta c={c} />
              </span>
              <DeleteButton id={c.id} className="relative z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
