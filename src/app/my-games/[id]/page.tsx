import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissFinding, refreshMyGame, removeMyGame } from "@/app/actions";
import { AnalyzeButton } from "@/components/ai-buttons";
import { PageHeader, Section } from "@/components/page-parts";
import { getApiKey } from "@/lib/ai";
import { getFindings, getMyGame, loadDashboard, type Format, type MetricResult } from "@/lib/analytics";
import { ago, num } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function fmt(v: number | null, f: Format): string {
  if (v == null) return "–";
  switch (f) {
    case "pct":
      return `${v.toFixed(v < 10 ? 1 : 0)}%`;
    case "min":
      return `${v.toFixed(1)} min`;
    case "robux":
      return `${num(Math.round(v))} R$`;
    case "fps":
      return v.toFixed(0);
    case "dec":
      return v.toFixed(2);
    default:
      return num(Math.round(v));
  }
}

function Spark({ points, good }: { points: { v: number }[]; good: boolean | null }) {
  if (points.length < 2) return <div className="h-8" />;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (vals.length - 1)) * 100).toFixed(1)},${(30 - ((v - min) / span) * 28).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <path d={d} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className={good == null ? "stroke-muted-foreground/50" : good ? "stroke-emerald-400" : "stroke-rose-400"} />
    </svg>
  );
}

function Kpi({ m }: { m: MetricResult }) {
  const change = m.changePct;
  const meaningful = change != null && Math.abs(change) >= 2;
  const good = meaningful ? (change > 0) === (m.def.goodWhen === "up") : null;
  return (
    <div title={m.error ? m.error : m.def.help}>
      <div className="text-xs text-muted-foreground">{m.def.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tracking-tight tabular-nums ${m.current == null ? "text-muted-foreground/40" : ""}`}>{fmt(m.current, m.def.format)}</span>
        {change != null && (
          <span className={`text-xs tabular-nums ${good == null ? "text-muted-foreground" : good ? "text-emerald-400" : "text-rose-400"}`}>
            {change > 0 ? "+" : change < 0 ? "−" : ""}
            {Math.abs(change).toFixed(change < 10 && change > -10 ? 1 : 0)}%
          </span>
        )}
      </div>
      {m.current == null ? <div className="mt-1 h-8 text-xs text-muted-foreground/60">{m.error ? "Not available" : "No data"}</div> : <Spark points={m.series} good={good} />}
    </div>
  );
}

const SEVERITY: Record<string, string> = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-muted-foreground/50" };

export default async function MyGamePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const game = Number.isFinite(id) ? await getMyGame(id) : null;
  if (!game) notFound();

  const [dash, findings, key] = await Promise.all([loadDashboard(id).catch((e: Error) => ({ error: e.message })), getFindings(id), getApiKey()]);
  const groups = "error" in dash ? [] : [...new Set(dash.metrics.map((m) => m.def.group))];
  const chokes = findings.filter((f) => f.kind === "chokepoint");
  const healthy = findings.filter((f) => f.kind === "healthy");

  return (
    <div className="mx-auto grid max-w-[100rem] gap-10">
      <div className="grid gap-3">
        <Link href="/my-games" className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> My games
        </Link>
        <PageHeader title={game.name} subtitle={"error" in dash ? `Key: ${game.label}` : `Last ${dash.days} complete days against the ${dash.days} before · key: ${game.label}`}>
          <div className="flex items-center gap-2">
            <form action={refreshMyGame}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="ghost" size="sm" title="Numbers are cached for an hour; this fetches them again">
                <RefreshCw /> Refresh
              </Button>
            </form>
            <Link href={`/games/${id}`} className="rounded-lg px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              Public stats
            </Link>
          </div>
        </PageHeader>
      </div>

      {"error" in dash ? (
        <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{dash.error}</p>
      ) : dash.allFailed ? (
        <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <p className="font-medium">Roblox did not return any analytics for this game.</p>
          <p className="mt-1 text-rose-300/80">{dash.firstError}</p>
        </div>
      ) : (
        <>
          <Section title="Choke-points" hint="Where the numbers show players or revenue being lost. Analytics only: no fixes, and you can dismiss any of them.">
            <div className="flex items-center gap-3">
              {key ? <AnalyzeButton id={id} hasRun={findings.length > 0} /> : <span className="text-sm text-muted-foreground">Add a Claude API key in Settings to turn this on.</span>}
              {findings[0] && <span className="text-xs text-muted-foreground">Checked {ago(findings[0].run_ts)}</span>}
            </div>
            {chokes.length > 0 && (
              <ul className="grid gap-2">
                {chokes.map((f) => (
                  <li key={f.id} className="flex items-start gap-3 rounded-xl bg-muted/40 px-4 py-3">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${SEVERITY[f.severity] ?? SEVERITY.low}`} title={`${f.severity} impact`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{f.title}</div>
                      <div className="mt-0.5 text-sm text-muted-foreground">{f.evidence}</div>
                      <div className="mt-1 text-xs text-muted-foreground/70">
                        {f.severity} impact · {f.confidence} confidence
                      </div>
                    </div>
                    <form action={dismissFinding}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="game" value={id} />
                      <button type="submit" aria-label="Dismiss this finding" title="Dismiss: not a real problem" className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                        <X className="size-3.5" />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {findings.length > 0 && chokes.length === 0 && <p className="text-sm text-muted-foreground">No choke-points found in the last check.</p>}
            {healthy.length > 0 && (
              <ul className="grid gap-1 text-sm text-muted-foreground">
                {healthy.map((f) => (
                  <li key={f.id} className="flex items-baseline gap-2">
                    <span className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-emerald-500" />
                    <span>
                      <span className="text-foreground">{f.title}.</span> {f.evidence}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {groups.map((group) => (
            <Section key={group} title={group} hint={group === "Performance" ? "Roblox keeps 28 days of these, so there is no previous period" : undefined}>
              <div className="grid grid-cols-2 gap-x-8 gap-y-7 md:grid-cols-3 lg:grid-cols-4">
                {dash.metrics
                  .filter((m) => m.def.group === group)
                  .map((m) => (
                    <Kpi key={m.def.id} m={m} />
                  ))}
              </div>
            </Section>
          ))}

          <Section title="Breakdowns" hint={`Last ${dash.days} days`}>
            <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
              {dash.breakdowns
                .filter((b) => b.rows.length > 0)
                .map((b) => {
                  const max = Math.max(...b.rows.map((r) => r.value));
                  return (
                    <div key={b.label}>
                      <div className="mb-2 text-sm font-medium">{b.label}</div>
                      <div className="grid gap-1.5">
                        {b.rows.map((r) => (
                          <div key={r.name} className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-3 text-xs">
                            <span className="truncate text-muted-foreground">{r.name}</span>
                            <div className="h-1.5 rounded-full bg-muted">
                              <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
                            </div>
                            <span className="text-right tabular-nums">{fmt(r.value, b.format)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              {dash.breakdowns.every((b) => b.rows.length === 0) && <p className="text-sm text-muted-foreground">No breakdown data yet.</p>}
            </div>
          </Section>
        </>
      )}

      <form action={removeMyGame} className="border-t pt-4">
        <input type="hidden" name="id" value={id} />
        <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
          Disconnect this game
        </Button>
      </form>
    </div>
  );
}
