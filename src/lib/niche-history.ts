import type { InStatement } from "@libsql/client";
import { db, kvGet, kvSet, now, q, run } from "./db";
import { freshNiches, type Niche, type NicheKind } from "./niches";

// How each niche changes over time. The collector writes one row per niche per
// hour; pages read them back as a chart and as "against yesterday / last week".

const HOUR = 3600;
const KEYWORD_LIMIT = 400; // title words are endless; keep the biggest

/** Called by the collector after each cycle. Writes at most once per hour. */
export async function recordNicheHistory(): Promise<number> {
  const bucket = Math.floor(now() / HOUR) * HOUR;
  if (Number((await kvGet("niche_history_at")) ?? "0") >= bucket) return 0;
  const niches = await freshNiches();
  const keep = [
    ...niches.filter((n) => n.kind !== "keyword"),
    ...niches.filter((n) => n.kind === "keyword").sort((a, b) => b.players - a.players).slice(0, KEYWORD_LIMIT),
  ];
  const stmts: InStatement[] = keep.map((n) => ({
    sql: "INSERT OR REPLACE INTO niche_history (kind, term, ts, games, hot, fresh, players) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [n.kind, n.term, bucket, n.games, n.hot, n.fresh, n.players],
  }));
  for (let i = 0; i < stmts.length; i += 200) await db().batch(stmts.slice(i, i + 200), "write");
  await kvSet("niche_history_at", String(bucket));
  // Older than 30 days: keep one row every six hours.
  await run("DELETE FROM niche_history WHERE ts < ? AND (ts % 21600) != 0", [bucket - 30 * 86400]);
  return stmts.length;
}

export type NichePoint = { ts: number; players: number; games: number; hot: number | null; fresh: number | null };

export async function getNicheHistory(kind: NicheKind, term: string): Promise<NichePoint[]> {
  const rows = await q<NichePoint>("SELECT ts, players, games, hot, fresh FROM niche_history WHERE kind = ? AND term = ? ORDER BY ts", [kind, term]);
  return rows.map((r) => ({ ts: Number(r.ts), players: Number(r.players), games: Number(r.games), hot: r.hot == null ? null : Number(r.hot), fresh: r.fresh == null ? null : Number(r.fresh) }));
}

export type NicheTrend = { day: number | null; week: number | null }; // percent change in players

const pct = (nowV: number | undefined, then: number | undefined) => (nowV != null && then != null && then >= 20 ? Math.round(((nowV - then) / then) * 100) : null);

/**
 * Player change for every niche of one kind, against the same hour yesterday
 * and the same hours a week ago. Comparing like hours keeps the daily cycle
 * (everyone logging on in the evening) out of the number.
 */
export async function getNicheTrends(kind: NicheKind): Promise<Map<string, NicheTrend>> {
  const latest = await q<{ ts: number | null }>("SELECT MAX(ts) AS ts FROM niche_history WHERE kind = ?", [kind]);
  const t = Number(latest[0]?.ts ?? 0);
  const out = new Map<string, NicheTrend>();
  if (!t) return out;
  const avg = async (from: number, to: number) =>
    new Map((await q<{ term: string; p: number }>("SELECT term, AVG(players) AS p FROM niche_history WHERE kind = ? AND ts BETWEEN ? AND ? GROUP BY term", [kind, from, to])).map((r) => [r.term, Number(r.p)]));
  const [cur, day, weekNow, weekThen] = await Promise.all([
    avg(t - HOUR, t),
    avg(t - 25 * HOUR, t - 24 * HOUR),
    avg(t - 23 * HOUR, t), // the last 24 hours ...
    avg(t - 8 * 86400 + HOUR, t - 7 * 86400), // ... against the same 24 hours a week earlier
  ]);
  for (const [term, v] of cur) out.set(term, { day: pct(v, day.get(term)), week: pct(weekNow.get(term), weekThen.get(term)) });
  return out;
}

export function trendOf(trends: Map<string, NicheTrend>, n: Pick<Niche, "term">): NicheTrend {
  return trends.get(n.term) ?? { day: null, week: null };
}
