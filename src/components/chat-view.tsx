"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowUp, Check, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { deleteChatAction, setModelAction } from "@/app/actions";
import { cn } from "@/lib/utils";

type Step = { label: string; at: number; ms?: number };
type Turn = { role: "user" | "assistant"; text: string; tools: string[]; steps?: Step[]; seconds?: number };
export type ModelOption = { id: string; label: string; blurb: string; input: number; output: number };

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
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg font-bold tracking-tight", GRADE_STYLE[grade] ?? "bg-muted", size === "lg" ? "h-11 min-w-11 px-2.5 text-lg" : "h-6 min-w-7 px-1.5 text-xs")}>
      {grade}
    </span>
  );
}

function Reply({ text }: { text: string }) {
  return (
    <div className="prose-chat min-w-0 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Wide tables scroll inside their own box; the page itself never scrolls sideways.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target={href?.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const STARTERS = [
  "What are the three most promising niches right now for a solo dev, and why?",
  "Idea: a ragdoll physics game where you launch yourself through obstacle courses to earn upgrades. Grade it.",
  "Which new games under 30 days old are growing fastest, and what do they have in common?",
];

/** Stamp a duration on any step that is still open. */
const closeSteps = (steps: Step[] | undefined): Step[] => (steps ?? []).map((s) => (s.ms == null ? { ...s, ms: Date.now() - s.at } : s));
const secs = (ms: number) => (ms < 950 ? "<1s" : `${Math.round(ms / 1000)}s`);

const money = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);

export function ChatView({
  chatId,
  title,
  initialTurns,
  initialGrade,
  initialReason,
  models,
  initialModel,
  budget,
  initialChatCost,
}: {
  chatId: number | null;
  title: string | null;
  initialTurns: Turn[];
  initialGrade: string | null;
  initialReason: string | null;
  models: ModelOption[];
  initialModel: string;
  budget: { remaining: number; monthlyBudget: number };
  initialChatCost: number;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [grade, setGrade] = useState(initialGrade);
  const [reason, setReason] = useState(initialReason);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState(initialModel);
  const [remaining, setRemaining] = useState(budget.remaining);
  const [chatCost, setChatCost] = useState(initialChatCost);
  const [turnCost, setTurnCost] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [lastTurn, setLastTurn] = useState<string | null>(null);
  const idRef = useRef<number | null>(chatId);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  function pickModel(id: string) {
    setModel(id);
    void setModelAction(id);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setLastTurn(null);
    setTurnCost(0);
    setSeconds(0);
    setInput("");
    setTurns((t) => [...t, { role: "user", text: message, tools: [] }, { role: "assistant", text: "", tools: [], steps: [] }]);
    const patchLast = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: idRef.current, message, model }) });
      if (!res.ok || !res.body) throw new Error(`The server returned ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const e = JSON.parse(line) as { type: string; id?: number; delta?: string; name?: string; summary?: string; grade?: string; reason?: string; message?: string; model?: string; cost?: number; chatCost?: number; remaining?: number; seconds?: number };
          if (e.type === "chat" && e.id) idRef.current = e.id;
          else if (e.type === "text") patchLast((t) => ({ ...t, steps: closeSteps(t.steps), text: t.text + (e.delta ?? "") }));
          else if (e.type === "tool")
            patchLast((t) => ({
              ...t,
              text: t.text && !t.text.endsWith("\n\n") ? t.text + "\n\n" : t.text,
              tools: [...t.tools, e.name ?? ""],
              steps: [...closeSteps(t.steps), { label: e.summary ?? "Working", at: Date.now() }],
            }));
          else if (e.type === "grade") {
            setGrade(e.grade ?? null);
            setReason(e.reason ?? null);
          } else if (e.type === "usage") setTurnCost(e.cost ?? 0);
          else if (e.type === "error") {
            setError(e.message ?? "Something went wrong");
            finished = true;
          } else if (e.type === "done") {
            finished = true;
            setRemaining(e.remaining ?? remaining);
            setChatCost(e.chatCost ?? chatCost);
            setLastTurn(`${e.model} · ${money(e.cost ?? 0)} · ${e.seconds}s`);
            patchLast((t) => ({ ...t, steps: closeSteps(t.steps), seconds: e.seconds }));
          }
        }
      }
      if (!finished) setError("The connection dropped before the reply finished. What was written so far is saved; ask again to continue.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (chatId == null && idRef.current != null) router.replace(`/ideas/${idRef.current}`);
      else router.refresh();
    }
  }

  const used = Math.min(100, Math.max(0, (1 - remaining / Math.max(budget.monthlyBudget, 0.01)) * 100));
  const current = models.find((m) => m.id === model) ?? models[0];

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-3xl min-w-0 flex-col">
      {/* Top bar: where you are, which model, what it costs */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/ideas" className="inline-flex items-center gap-1.5 rounded-lg py-1 pr-2 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All ideas
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title ?? "New idea"}</span>
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Model">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === model}
              disabled={busy}
              onClick={() => pickModel(m.id)}
              title={`${m.blurb}. $${m.input} in / $${m.output} out per million tokens.`}
              className={cn("rounded-md px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", m.id === model ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {m.label.replace(" 5.5", "")}
            </button>
          ))}
        </div>
        {chatId != null && (
          <form action={deleteChatAction}>
            <input type="hidden" name="id" value={chatId} />
            <button type="submit" aria-label="Delete this conversation" title="Delete this conversation" className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-rose-300">
              <Trash2 className="size-3.5" />
            </button>
          </form>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-2" title={`${money(budget.monthlyBudget - remaining)} of $${budget.monthlyBudget.toFixed(0)} used this month`}>
          <span className="font-medium text-foreground tabular-nums">${remaining.toFixed(2)}</span> left this month
          <span className="h-1 w-20 overflow-hidden rounded-full bg-muted">
            <span className={cn("block h-full rounded-full", used > 75 ? "bg-amber-500" : "bg-sky-500")} style={{ width: `${used}%` }} />
          </span>
        </span>
        <span>
          This chat <span className="text-foreground tabular-nums">{money(chatCost + (busy ? turnCost : 0))}</span>
        </span>
        <span title={`$${current.input} in / $${current.output} out per million tokens`}>
          {current.label}: {current.blurb.toLowerCase()}
        </span>
        {lastTurn && !busy && <span className="ml-auto">Last reply: {lastTurn}</span>}
        {busy && (
          <span className="ml-auto flex items-center gap-1.5 text-foreground tabular-nums">
            <Loader2 className="size-3 animate-spin" /> {seconds}s · {money(turnCost)}
          </span>
        )}
      </div>

      {grade && (
        <div className="mb-3 flex items-center gap-3 rounded-xl bg-muted/40 px-3.5 py-2.5">
          <GradeBadge grade={grade} size="lg" />
          <div className="min-w-0 text-sm">{reason}</div>
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-2">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Pitch an idea, or ask what is working</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Every answer is checked against the games tracked here. Ideas get a grade from F to SSS; A is high praise, and S or above is reserved for platform-changing potential.
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
          <div className="grid min-w-0 gap-6 pb-4">
            {turns.map((t, i) => {
              const live = busy && i === turns.length - 1;
              return t.role === "user" ? (
                <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm break-words whitespace-pre-wrap">
                  {t.text}
                </div>
              ) : (
                <div key={i} className="grid min-w-0 gap-2.5">
                  {t.steps && t.steps.length > 0 ? (
                    live ? (
                      <ul className="grid gap-1 text-xs text-muted-foreground">
                        {t.steps.map((s, j) => (
                          <li key={j} className="flex items-center gap-2">
                            {s.ms == null ? <Loader2 className="size-3 shrink-0 animate-spin text-sky-400" /> : <Check className="size-3 shrink-0 text-emerald-400" />}
                            <span className={cn("truncate", s.ms == null && "text-foreground")}>{s.label}</span>
                            {s.ms != null && <span className="shrink-0 tabular-nums opacity-60">{secs(s.ms)}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <details className="group text-xs text-muted-foreground">
                        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 hover:text-foreground">
                          <Check className="size-3 text-emerald-400" />
                          Researched{t.seconds != null ? ` for ${t.seconds}s` : ""} · {t.steps.length} {t.steps.length === 1 ? "lookup" : "lookups"}
                          <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                        </summary>
                        <ul className="mt-1.5 grid gap-1 border-l border-border pl-3">
                          {t.steps.map((s, j) => (
                            <li key={j} className="flex items-center gap-2">
                              <span className="truncate">{s.label}</span>
                              {s.ms != null && <span className="shrink-0 tabular-nums opacity-60">{secs(s.ms)}</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )
                  ) : t.tools.length > 0 ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Check className="size-3 text-emerald-400" />
                      Checked the data {t.tools.length} {t.tools.length === 1 ? "time" : "times"}
                    </div>
                  ) : null}
                  {t.text ? (
                    <Reply text={t.text} />
                  ) : live && !(t.steps && t.steps.length) ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Thinking
                    </div>
                  ) : null}
                </div>
              );
            })}
            {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm break-words text-rose-300">{error}</p>}
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
          placeholder={busy ? "Writing the reply…" : "Describe a game idea, or ask about the market"}
          className="max-h-48 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button type="submit" aria-label="Send" disabled={busy || !input.trim()} className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity disabled:opacity-30">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </form>
    </div>
  );
}
