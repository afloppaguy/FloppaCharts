"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "assistant"; text: string; tools: string[] };

const GRADE_STYLE: Record<string, string> = {
  F: "bg-rose-500/15 text-rose-300",
  E: "bg-rose-500/15 text-rose-300",
  D: "bg-orange-500/15 text-orange-300",
  C: "bg-amber-500/15 text-amber-300",
  B: "bg-lime-500/15 text-lime-300",
  A: "bg-emerald-500/15 text-emerald-300",
  S: "bg-sky-500/15 text-sky-300",
  SS: "bg-violet-500/15 text-violet-300",
  SSS: "bg-fuchsia-500/20 text-fuchsia-200",
};

export function GradeBadge({ grade, size = "sm" }: { grade: string | null; size?: "sm" | "lg" }) {
  if (!grade) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg font-bold tracking-tight", GRADE_STYLE[grade] ?? "bg-muted", size === "lg" ? "h-12 min-w-12 px-2.5 text-xl" : "h-6 min-w-7 px-1.5 text-xs")}>
      {grade}
    </span>
  );
}

const TOOL_LABEL: Record<string, string> = {
  list_games: "Looked through tracked games",
  get_game: "Opened a game",
  get_game_history: "Read a game's history",
  list_niches: "Checked niches",
  search_roblox: "Searched Roblox",
  query_database: "Queried the database",
  get_status: "Checked the dataset",
  list_notes: "Read your notes",
  add_game: "Added a game",
  backfill_history: "Fetched older history",
  set_tags: "Tagged a game",
  set_watch: "Updated the watchlist",
  save_preset: "Saved a preset",
};

function Reply({ text }: { text: string }) {
  return (
    <div className="prose-chat text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

const STARTERS = [
  "What are the three most promising niches right now for a solo dev, and why?",
  "Idea: a ragdoll physics game where you launch yourself through obstacle courses to earn upgrades. Grade it.",
  "Which new games under 30 days old are growing fastest, and what do they have in common?",
];

export function ChatView({ chatId, initialTurns, initialGrade, initialReason }: { chatId: number | null; initialTurns: Turn[]; initialGrade: string | null; initialReason: string | null }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [grade, setGrade] = useState(initialGrade);
  const [reason, setReason] = useState(initialReason);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [footer, setFooter] = useState<string | null>(null);
  const idRef = useRef<number | null>(chatId);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, activity]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setFooter(null);
    setInput("");
    setActivity("Thinking");
    setTurns((t) => [...t, { role: "user", text: message, tools: [] }, { role: "assistant", text: "", tools: [] }]);
    const patchLast = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: idRef.current, message }) });
      if (!res.ok || !res.body) throw new Error(`The server returned ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const e = JSON.parse(line) as { type: string; id?: number; delta?: string; name?: string; grade?: string; reason?: string; message?: string; model?: string; cost?: number };
          if (e.type === "chat" && e.id) idRef.current = e.id;
          else if (e.type === "text") {
            setActivity(null);
            patchLast((t) => ({ ...t, text: t.text + (e.delta ?? "") }));
          } else if (e.type === "tool") {
            setActivity(TOOL_LABEL[e.name ?? ""] ?? "Working");
            patchLast((t) => ({ ...t, text: t.text && !t.text.endsWith("\n\n") ? t.text + "\n\n" : t.text, tools: [...t.tools, e.name ?? ""] }));
          } else if (e.type === "grade") {
            setGrade(e.grade ?? null);
            setReason(e.reason ?? null);
          } else if (e.type === "error") setError(e.message ?? "Something went wrong");
          else if (e.type === "done") setFooter(`${e.model?.includes("haiku") ? "Haiku 5.5" : "Sonnet 5.5"} · $${(e.cost ?? 0).toFixed(3)}`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setActivity(null);
      if (chatId == null && idRef.current != null) router.replace(`/ideas/${idRef.current}`);
      else router.refresh();
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-3xl flex-col">
      {grade && (
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3">
          <GradeBadge grade={grade} size="lg" />
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Current grade</div>
            <div className="text-sm">{reason}</div>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Pitch an idea, or ask what is working</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Claude checks every answer against the games tracked here and grades ideas from F to SSS. It can also plan a game with you.
              </p>
            </div>
            <div className="grid w-full max-w-xl gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-xl bg-muted/50 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-6 pb-4">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
                  {t.text}
                </div>
              ) : (
                <div key={i} className="grid gap-2">
                  {t.tools.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t.tools.map((n) => TOOL_LABEL[n] ?? n).join(", ")}>
                      <Wrench className="size-3" />
                      Checked the data {t.tools.length} {t.tools.length === 1 ? "time" : "times"}
                    </div>
                  )}
                  {t.text && <Reply text={t.text} />}
                </div>
              ),
            )}
            {activity && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-sky-400" />
                {activity}…
              </div>
            )}
            {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
            {footer && !busy && <p className="text-xs text-muted-foreground/70">{footer}</p>}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex items-end gap-2 rounded-2xl bg-muted/60 p-2 focus-within:ring-2 focus-within:ring-ring"
      >
        <textarea
          aria-label="Message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={Math.min(8, Math.max(1, input.split("\n").length))}
          placeholder="Describe a game idea, or ask about the market"
          className="max-h-48 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={busy || !input.trim()}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity disabled:opacity-30"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
    </div>
  );
}
