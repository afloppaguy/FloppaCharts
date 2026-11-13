import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissFinding, refreshMyGame, removeMyGame } from "@/app/actions";
import { AnalyzeButton } from "@/components/ai-buttons";
import { GameIcon } from "@/components/game-table";
import { MetricExplorer, SurvivalChart, type ExplorerMetric } from "@/components/metric-explorer";
import { fmtMetric } from "@/lib/metric-format";
import { Section } from "@/components/page-parts";
import { getApiKey } from "@/lib/ai";
import { funnel, getFindings, getMyGame, loadDashboard, whatChanged, type Segment, type SegmentSet } from "@/lib/analytics";
import { pollGames } from "@/lib/collector";
import { run } from "@/lib/db";
import { ago, num } from "@/lib/format";
import { getGame, iconsFor } from "@/lib/queries";
import { universeName } from "@/lib/roblox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RANGES = [7, 14, 28, 90];
const SEVERITY: Record<string, string> = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-muted-foreground/50" };

function Bars({ set, format = "int", empty = "No data yet." }: { set: SegmentSet; format?: ExplorerMetric["format"]; empty?: string }) {
  if (!set.rows.length) return <p className="text-sm text-muted-foreground">{set.error ? "Roblox did not return this breakdown." : empty}</p>;
  const max = Math.max(...set.rows.map((r) => r.value));
  return (
    <div className="grid gap-1.5">
      {set.rows.map((r: Segment) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={r.name}>
            {r.name}
          </span>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
          </div>
          <span className="w-28 text-right tabular-nums">
            {fmtMetric(r.value, format)}
            {r.share > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{r.share.toFixed(r.share < 10 ? 1 : 0)}%</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default async function MyGamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }> }) {
  const id = Number((await params).id);
  const game = Number.isFinite(id) ? await getMyGame(id) : null;
  if (!game) notFound();
  const days = RANGES.includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 28;

  // A game connected while Roblox was rate-limiting has a placeholder name; fix it once.
  let name = game.name;
  if (/^Game \d+$/.test(name)) {
    const real = await universeName(id);
    if (real) {
      name = real;
      await run("UPDATE my_games SET name = ? WHERE universe_id = ?", [real, id]);
    }
  }

  const [dash, findings, key, icons, pub] = await Promise.all([loadDashboard(id, days).catch((e: Error) => ({ error: e.message })), getFindings(id), getApiKey(), iconsFor([id]), getGame(id)]);
  // Make sure the game is also in the public tracker, so "playing now" and its public page exist.
  if (!pub) void pollGames([id], "manual").catch(() => 0);
  const chokes = findings.filter((f) => f.kind === "chokepoint");
  const healthy = findings.filter((f) => f.kind === "healthy");

  return (
    <div className="mx-auto grid max-w-[100rem] gap-10">
      <div className="grid gap-4">
        <Link href="/my-games" className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> My games
        </Link>
        <header className="flex flex-wrap items-center gap-4">
          <GameIcon url={icons.get(id)} size={64} className="rounded-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {pub ? `${num(pub.playing)} playing now · ` : ""}last {days} complete days against the {days} before
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5" role="group" aria-label="Period">
              {RANGES.map((d) => (
                <Link key={d} href={`/my-games/${id}?days=${d}`} aria-current={d === days ? "true" : undefined} className={`rounded-md px-2.5 py-1 text-xs ${d === days ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {d}d
                </Link>
              ))}
            </div>
            <form action={refreshMyGame}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="ghost" size="sm" title="Numbers are kept for an hour; this fetches them again from Roblox">
                <RefreshCw /> Refresh
              </Button>
            </form>
            <Link href={`/games/${id}`} className="rounded-lg px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              Public page
            </Link>
          </div>
        </header>
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
          {(() => {
            const changes = whatChanged(dash);
            return changes.length ? (
              <Section title="What changed" hint={`Biggest moves against the previous ${days} days`}>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {changes.map((c) => (
                    <div key={c.label} className="flex items-center gap-3 rounded-xl bg-muted/30 px-4 py-3">
                      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${c.good ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                        {c.pct > 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                      </span>
                      <div className="min-w-0 text-sm">
                        <div className="font-medium">
                          {c.label} {c.pct > 0 ? "up" : "down"} {Math.abs(c.pct).toFixed(Math.abs(c.pct) < 10 ? 1 : 0)}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtMetric(c.from, c.format)} → {fmtMetric(c.to, c.format)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null;
          })()}

          <Section title="Choke-points" hint="Where the numbers show players or revenue being lost. Analytics only: no fixes, and you can dismiss any of them.">
            <div className="flex items-center gap-3">
              {key ? <AnalyzeButton id={id} hasRun={findings.length > 0} /> : <span className="text-sm text-muted-foreground">Add a Claude API key in Settings to turn this on.</span>}
              {findings[0] && <span className="text-xs text-muted-foreground">Checked {ago(findings[0].run_ts)}</span>}
            </div>
            {chokes.length > 0 && (
              <ul className="grid gap-2 lg:grid-cols-2">
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

          <Section title="Metrics" hint="Click any number to chart it against the previous period">
            <MetricExplorer
              days={days}
              metrics={dash.metrics.map((m) => ({ id: m.def.id, label: m.def.label, group: m.def.group, format: m.def.format, goodWhen: m.def.goodWhen, help: m.def.help, current: m.current, previous: m.previous, changePct: m.changePct, series: m.series, prevSeries: m.prevSeries, error: m.error }))}
            />
          </Section>

          <div className="grid gap-10 xl:grid-cols-2">
            <Section title="Funnel" hint="From seeing your game to staying in it">
              {(() => {
                const steps = funnel(dash);
                if (steps.length < 2) return <p className="text-sm text-muted-foreground">Not enough acquisition data yet.</p>;
                return (
                  <div className="grid gap-2">
                    {steps.map((s, i) => (
                      <div key={s.label}>
                        {i > 0 && (
                          <div className="mb-2 ml-3 border-l border-border pl-3 text-xs text-muted-foreground">
                            <span className="text-foreground">{s.ofPrevious!.toFixed(s.ofPrevious! < 10 ? 1 : 0)}%</span> continue
                          </div>
                        )}
                        <div className="relative overflow-hidden rounded-lg bg-muted/40 px-3.5 py-2.5">
                          <div className="absolute inset-y-0 left-0 bg-sky-500/20" style={{ width: `${Math.max(1.5, s.ofFirst)}%` }} />
                          <div className="relative flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium">{s.label}</span>
                            <span className="tabular-nums">
                              {num(Math.round(s.value))}
                              <span className="ml-2 text-xs text-muted-foreground">{s.ofFirst.toFixed(s.ofFirst < 10 ? 2 : 0)}% of all</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Section>

            <Section title="Session drop-off" hint="How long sessions last">
              {dash.survival.curve.length > 1 ? (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Fact value={dash.survival.leftBy30s != null ? `${dash.survival.leftBy30s.toFixed(0)}%` : "–"} label="leave within 30 seconds" />
                    <Fact value={dash.survival.leftBy2min != null ? `${dash.survival.leftBy2min.toFixed(0)}%` : "–"} label="leave within 2 minutes" />
                    <Fact value={dash.survival.halfGoneSec != null ? (dash.survival.halfGoneSec < 60 ? `${dash.survival.halfGoneSec}s` : `${(dash.survival.halfGoneSec / 60).toFixed(1)} min`) : "–"} label="until half have left" />
                    <Fact value={dash.survival.stillAt10min != null ? `${dash.survival.stillAt10min.toFixed(0)}%` : "–"} label="still playing at 10 minutes" />
                  </div>
                  <SurvivalChart curve={dash.survival.curve} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No session data yet.</p>
              )}
            </Section>
          </div>

          <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-3">
            <Section title="Where players come from" hint="Players by source">
              <Bars set={dash.segments.source} />
            </Section>
            <Section title="New vs returning">
              <Bars set={dash.segments.newReturning} />
            </Section>
            <Section title="Platforms" hint="Players, and day-1 retention where known">
              <Bars set={dash.segments.platform} />
              {dash.segments.platformD1.rows.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {dash.segments.platformD1.rows.map((r) => (
                    <span key={r.name}>
                      {r.name} D1 <span className="text-foreground tabular-nums">{r.value.toFixed(1)}%</span>
                    </span>
                  ))}
                </div>
              )}
            </Section>
            <Section title="Top countries">
              <Bars set={dash.segments.country} />
            </Section>
            <Section title="Revenue by source">
              <Bars set={dash.segments.revenueSource} format="robux" empty="No revenue in this period." />
            </Section>
            <Section title="Best-selling products" hint="Robux earned per product">
              <Bars set={dash.segments.products} format="robux" empty="No product sales in this period." />
            </Section>
          </div>
        </>
      )}

      <form action={removeMyGame} className="border-t border-border/60 pt-4">
        <input type="hidden" name="id" value={id} />
        <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
          Disconnect this game
        </Button>
        <span className="ml-2 text-xs text-muted-foreground">Key: {game.label}</span>
      </form>
    </div>
  );
}
