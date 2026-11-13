import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getClient, pickModel, recordUsage } from "./ai";
import { nowMs } from "./clock";
import { now, q, run } from "./db";

// "My games": analytics for games you own, read from Roblox's Open Cloud
// Analytics Query API (beta) with an API key you create. The key needs the
// `universe.analytics:read` permission on the experience.
//
//   POST https://apis.roblox.com/analytics-query-api/v1/universes/{id}/metrics
//   header x-api-key; body { metric, granularity, startTime, endTime, breakdown? }
//   Small queries answer at once (done: true); large ones return a path to poll.

const BASE = "https://apis.roblox.com/analytics-query-api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Series = { breakdown: Record<string, string>; points: { t: number; v: number }[] };

type ApiReply = {
  path?: string;
  done?: boolean;
  error?: { code?: number | string; message?: string };
  response?: { values?: { breakdowns?: { dimension: string; value: string; displayValue?: string }[]; dataPoints?: { time: string; value?: number }[] }[] };
  errors?: { message?: string }[];
  message?: string;
};

export function parseReply(reply: ApiReply): Series[] {
  return (reply.response?.values ?? []).map((v) => ({
    breakdown: Object.fromEntries((v.breakdowns ?? []).map((b) => [b.dimension, b.displayValue ?? b.value])),
    points: (v.dataPoints ?? []).filter((p) => typeof p.value === "number").map((p) => ({ t: Math.floor(Date.parse(p.time) / 1000), v: p.value as number })),
  }));
}

export type MetricQuery = { metric: string; granularity: "OneDay" | "None" | "OneHour"; startTime: string; endTime: string; breakdown?: string[] };

async function callRoblox(apiKey: string, universeId: number, body: MetricQuery): Promise<Series[]> {
  const headers = { "x-api-key": apiKey, "Content-Type": "application/json" };
  let res = await fetch(`${BASE}/v1/universes/${universeId}/metrics`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (res.status === 429) {
    await sleep(4000);
    res = await fetch(`${BASE}/v1/universes/${universeId}/metrics`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  }
  let reply = (await res.json().catch(() => ({}))) as ApiReply;
  if (res.status === 401 || res.status === 403) throw new Error("Roblox rejected this API key for this game. It needs the universe.analytics:read permission with the game added under Access Permissions.");
  if (!res.ok && res.status !== 202) throw new Error(reply.error?.message ?? reply.errors?.[0]?.message ?? reply.message ?? `Roblox returned ${res.status}`);
  for (let i = 0; !reply.done && reply.path && i < 20; i++) {
    await sleep(1000 + i * 250);
    const poll = await fetch(`${BASE}/${reply.path.replace(/^\//, "")}`, { headers, signal: AbortSignal.timeout(30000) });
    reply = (await poll.json().catch(() => ({}))) as ApiReply;
  }
  if (!reply.done) throw new Error("Roblox is still computing this metric; try again shortly.");
  if (reply.error) throw new Error(reply.error.message ?? `Roblox error ${reply.error.code}`);
  return parseReply(reply);
}

/** One metric, cached for an hour so reopening a page does not re-query Roblox (limit: 30 queries a minute). */
export async function queryMetric(apiKey: string, universeId: number, body: MetricQuery, maxAgeSec = 3600): Promise<Series[]> {
  const cacheKey = JSON.stringify(body);
  const hit = await q<{ fetched_at: number; data: string }>("SELECT fetched_at, data FROM metric_cache WHERE universe_id = ? AND cache_key = ?", [universeId, cacheKey]);
  if (hit[0] && now() - Number(hit[0].fetched_at) < maxAgeSec) return JSON.parse(hit[0].data) as Series[];
  const series = await callRoblox(apiKey, universeId, body);
  await run(
    "INSERT INTO metric_cache (universe_id, cache_key, fetched_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(universe_id, cache_key) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data",
    [universeId, cacheKey, now(), JSON.stringify(series)],
  );
  return series;
}

export type Format = "int" | "pct" | "min" | "robux" | "fps" | "dec";
export type MetricDef = { id: string; label: string; group: string; format: Format; agg: "avg" | "sum" | "max"; goodWhen: "up" | "down"; perf?: boolean; help: string };

export const METRICS: MetricDef[] = [
  { id: "DailyActiveUsers", label: "Daily active users", group: "Engagement", format: "int", agg: "avg", goodWhen: "up", help: "Average unique players per day" },
  { id: "Visits", label: "Visits", group: "Engagement", format: "int", agg: "sum", goodWhen: "up", help: "Total sessions started in the period" },
  { id: "AveragePlayTimeMinutesPerDAU", label: "Playtime per player", group: "Engagement", format: "min", agg: "avg", goodWhen: "up", help: "Minutes played per active player per day" },
  { id: "AverageSessionLengthMinutes", label: "Session length", group: "Engagement", format: "min", agg: "avg", goodWhen: "up", help: "Average length of one session" },
  { id: "ForwardD1Retention", label: "Day 1 retention", group: "Retention", format: "pct", agg: "avg", goodWhen: "up", help: "New players who come back the next day" },
  { id: "ForwardD7Retention", label: "Day 7 retention", group: "Retention", format: "pct", agg: "avg", goodWhen: "up", help: "New players who come back a week later" },
  { id: "ForwardD30Retention", label: "Day 30 retention", group: "Retention", format: "pct", agg: "avg", goodWhen: "up", help: "New players who come back a month later" },
  { id: "DauMauStickiness", label: "Stickiness (DAU/MAU)", group: "Retention", format: "pct", agg: "avg", goodWhen: "up", help: "Share of monthly players who play on a given day" },
  { id: "DailyRevenue", label: "Revenue", group: "Monetization", format: "robux", agg: "sum", goodWhen: "up", help: "Robux earned in the period" },
  { id: "PayingUsersCVR", label: "Payer conversion", group: "Monetization", format: "pct", agg: "avg", goodWhen: "up", help: "Share of daily players who spend" },
  { id: "AverageRevenuePerPayingUser", label: "Revenue per payer", group: "Monetization", format: "robux", agg: "avg", goodWhen: "up", help: "Average Robux per paying player per day" },
  { id: "AverageRevenuePerUser", label: "Revenue per player", group: "Monetization", format: "dec", agg: "avg", goodWhen: "up", help: "Average Robux per active player per day" },
  { id: "UniqueUsersWithImpressions", label: "People who saw the game", group: "Acquisition", format: "int", agg: "sum", goodWhen: "up", help: "Players shown your game's tile on Roblox" },
  { id: "ImpressionCVR", label: "Tile click rate", group: "Acquisition", format: "pct", agg: "avg", goodWhen: "up", help: "Share of impressions that led to a click" },
  { id: "QualifiedEndToEndCVR", label: "Impression to real play", group: "Acquisition", format: "pct", agg: "avg", goodWhen: "up", help: "Share of impressions that became a qualified play session" },
  { id: "QualifiedUniqueUsersWithPlaySessions", label: "Qualified new plays", group: "Acquisition", format: "int", agg: "sum", goodWhen: "up", help: "Players who joined and stayed past the qualifying threshold" },
  { id: "PeakConcurrentPlayers", label: "Peak concurrent", group: "Performance", format: "int", agg: "max", goodWhen: "up", perf: true, help: "Highest simultaneous players" },
  { id: "ClientCrashRate15m", label: "Client crash rate", group: "Performance", format: "pct", agg: "avg", goodWhen: "down", perf: true, help: "Share of sessions that crash within 15 minutes" },
  { id: "ClientFpsP50", label: "Client FPS (median)", group: "Performance", format: "fps", agg: "avg", goodWhen: "up", perf: true, help: "Median frame rate on players' devices" },
  { id: "ClientFpsP10", label: "Client FPS (worst 10%)", group: "Performance", format: "fps", agg: "avg", goodWhen: "up", perf: true, help: "Frame rate of the slowest tenth of players" },
  { id: "ServerFrameRateAvg", label: "Server frame rate", group: "Performance", format: "fps", agg: "avg", goodWhen: "up", perf: true, help: "Average server heartbeat; 60 is healthy" },
];

export const BREAKDOWNS: { metric: string; dimension: string; label: string; format: Format; granularity: "None" | "OneDay" }[] = [
  { metric: "DailyActiveUsers", dimension: "Platform", label: "Players by platform", format: "int", granularity: "OneDay" },
  { metric: "ForwardD1Retention", dimension: "Platform", label: "Day 1 retention by platform", format: "pct", granularity: "OneDay" },
  { metric: "AverageSessionLengthMinutes", dimension: "Platform", label: "Session length by platform", format: "min", granularity: "OneDay" },
  { metric: "TotalSessionsEndedInBucket", dimension: "SessionTimeBucket", label: "How long sessions last", format: "int", granularity: "OneDay" },
  { metric: "DailyActiveUsers", dimension: "IsNewUser", label: "New vs returning players", format: "int", granularity: "OneDay" },
];

export type MetricResult = {
  def: MetricDef;
  current: number | null;
  previous: number | null;
  changePct: number | null;
  series: { t: number; v: number }[];
  error?: string;
};
export type BreakdownResult = { label: string; metric: string; dimension: string; format: Format; rows: { name: string; value: number }[]; error?: string };

const aggregate = (vals: number[], how: MetricDef["agg"]) => (!vals.length ? null : how === "sum" ? vals.reduce((a, b) => a + b, 0) : how === "max" ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0) / vals.length);

/** Ratios come back as 0-1 fractions for some metrics and 0-100 for others; show all of them as percent. */
function normalize(def: { format: Format }, points: { t: number; v: number }[]) {
  if (def.format !== "pct" || !points.length) return points;
  const max = Math.max(...points.map((p) => p.v));
  return max <= 1.5 ? points.map((p) => ({ t: p.t, v: p.v * 100 })) : points;
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function getMyGame(universeId: number) {
  const r = await q<{ universe_id: number; name: string; key_id: number; api_key: string; label: string }>(
    "SELECT g.universe_id, g.name, g.key_id, k.api_key, k.label FROM my_games g JOIN rbx_keys k ON k.id = g.key_id WHERE g.universe_id = ?",
    [universeId],
  );
  return r[0] ?? null;
}

/** Everything the My Game page shows: each metric for the last `days` days against the `days` before that. */
export async function loadDashboard(universeId: number, days = 28) {
  const game = await getMyGame(universeId);
  if (!game) throw new Error("That game is not connected.");
  const end = new Date(nowMs());
  end.setUTCHours(0, 0, 0, 0); // today's UTC midnight, exclusive: only complete days
  const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");
  const endTs = Math.floor(end.getTime() / 1000);
  const split = endTs - days * 86400;

  const metrics = await pool(METRICS, 4, async (def): Promise<MetricResult> => {
    // Performance metrics only keep 28 days, so they have no "previous period".
    const span = def.perf ? Math.min(days, 27) : days * 2;
    const start = new Date(end.getTime() - span * 86400_000);
    try {
      const series = await queryMetric(game.api_key, universeId, { metric: def.id, granularity: "OneDay", startTime: iso(start), endTime: iso(end) });
      const points = normalize(def, series[0]?.points ?? []).sort((a, b) => a.t - b.t);
      const cur = aggregate(points.filter((p) => p.t >= split).map((p) => p.v), def.agg);
      const prev = def.perf ? null : aggregate(points.filter((p) => p.t < split).map((p) => p.v), def.agg);
      return { def, current: cur, previous: prev, changePct: cur != null && prev != null && prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null, series: points.filter((p) => p.t >= split) };
    } catch (e) {
      return { def, current: null, previous: null, changePct: null, series: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  const breakdowns = await pool(BREAKDOWNS, 3, async (b): Promise<BreakdownResult> => {
    const start = new Date(end.getTime() - days * 86400_000);
    try {
      const series = await queryMetric(game.api_key, universeId, { metric: b.metric, granularity: b.granularity, startTime: iso(start), endTime: iso(end), breakdown: [b.dimension] });
      const how = b.format === "int" && b.metric !== "DailyActiveUsers" ? "sum" : "avg";
      const rows = series
        .map((s) => ({ name: s.breakdown[b.dimension] ?? "Unknown", value: aggregate(normalize(b, s.points).map((p) => p.v), how) ?? 0 }))
        .filter((r) => r.value > 0);
      if (b.dimension !== "SessionTimeBucket") rows.sort((x, y) => y.value - x.value);
      return { ...b, rows: rows.slice(0, 8) };
    } catch (e) {
      return { ...b, rows: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  return { game: { universe_id: Number(game.universe_id), name: game.name, keyLabel: game.label }, days, metrics, breakdowns, allFailed: metrics.every((m) => m.error), firstError: metrics.find((m) => m.error)?.error ?? null };
}

// ---- AI read of the numbers ----

const Findings = z.object({
  findings: z.array(
    z.object({
      kind: z.enum(["chokepoint", "healthy"]),
      severity: z.enum(["high", "medium", "low"]).describe("For choke-points: how much it is likely costing. For healthy checks use low."),
      title: z.string().describe("Under 10 words, names the metric and what is wrong or fine"),
      evidence: z.string().describe("The exact numbers that show it, with the comparison used"),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

const ANALYST = `You read analytics for one Roblox game and report what the numbers show. The developer will read your findings in a dashboard and can dismiss any they disagree with.

You receive, for the last period and the period before it: engagement, retention, monetization, acquisition and performance metrics with daily values, plus breakdowns by platform, new vs returning players, and session length.

Report two kinds of finding:
- chokepoint: a place where the numbers show players or revenue being lost. Examples of what counts: a metric that fell meaningfully against the previous period; one platform retaining or performing far worse than the others; a large share of sessions ending in the shortest bucket; many impressions but few qualified plays; crash rate or low frame rate concentrated somewhere; payer conversion falling while players hold steady.
- healthy: a metric that is clearly stable or improving, worth one line so the developer knows it was checked.

Rules:
- Analytics only. You have never seen or played this game and know nothing about its content. Never say how to fix anything, never suggest features, changes, or experiments, and never guess at causes inside the game. State what the data shows and stop.
- Every finding must quote the numbers behind it, including what it is compared against (previous period, another platform, another segment).
- Judge significance by size and sample. Small daily player counts make percentages noisy: when the player base is small or the change is small, lower the confidence or leave the finding out. A change under about 5% is not a finding.
- Missing metrics are not findings. If a metric has no data, ignore it.
- Order findings by how much they matter. Report at most 6 choke-points and 4 healthy checks. If nothing is wrong, return only healthy checks.`;

export async function analyzeGame(universeId: number) {
  const dash = await loadDashboard(universeId);
  if (dash.allFailed) throw new Error(dash.firstError ?? "No analytics data could be loaded for this game.");
  const round = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  const payload = {
    period_days: dash.days,
    metrics: dash.metrics
      .filter((m) => !m.error && m.current != null)
      .map((m) => ({ metric: m.def.label, group: m.def.group, unit: m.def.format, better_when: m.def.goodWhen, this_period: round(m.current), previous_period: round(m.previous), change_pct: round(m.changePct), daily: m.series.map((p) => round(p.v)) })),
    breakdowns: dash.breakdowns.filter((b) => b.rows.length).map((b) => ({ what: b.label, unit: b.format, rows: b.rows.map((r) => ({ segment: r.name, value: round(r.value) })) })),
  };
  const client = await getClient();
  const model = await pickModel();
  const response = await client.messages.parse({
    model,
    max_tokens: 8000,
    system: ANALYST,
    messages: [{ role: "user", content: `Analytics for the game, as JSON:\n\n${JSON.stringify(payload)}` }],
    output_config: { format: zodOutputFormat(Findings), effort: "medium" },
  });
  const cost = await recordUsage("choke-points", model, response.usage);
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude did not return a usable analysis. Try again.");
  const ts = now();
  // A new run replaces the previous run's undismissed findings; dismissed ones stay hidden.
  await run("DELETE FROM findings WHERE universe_id = ? AND dismissed = 0", [universeId]);
  for (const f of response.parsed_output.findings) {
    await run("INSERT INTO findings (universe_id, run_ts, kind, severity, title, evidence, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)", [universeId, ts, f.kind, f.severity, f.title, f.evidence, f.confidence]);
  }
  return { findings: response.parsed_output.findings.length, cost, model };
}

export async function getFindings(universeId: number) {
  return q<{ id: number; run_ts: number; kind: string; severity: string; title: string; evidence: string; confidence: string }>(
    "SELECT id, run_ts, kind, severity, title, evidence, confidence FROM findings WHERE universe_id = ? AND dismissed = 0 ORDER BY kind = 'healthy', CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id",
    [universeId],
  );
}
