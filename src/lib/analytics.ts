import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getClient, pickModel, recordUsage } from "./ai";
import { nowMs } from "./clock";
import { now, q, run } from "./db";
import { uidNow } from "./scope";
import { decryptSecret } from "./security";

// "My games": analytics for games you own, read from Roblox's Open Cloud
// Analytics Query API (beta) with an API key you create. The key needs the
// `universe.analytics:read` permission on the experience.
//
//   POST https://apis.roblox.com/analytics-query-api/v1/universes/{id}/metrics
//   header x-api-key; body { metric, granularity, startTime, endTime, breakdown? }
//   Small queries answer at once (done: true); large ones return a path to poll.
//   Granularity "None" with a breakdown returns one total per segment.
//   Roblox allows 30 queries a minute per key owner, so a page load stays under that.

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
  const post = () => fetch(`${BASE}/v1/universes/${universeId}/metrics`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  let res = await post();
  // Rate limited: back off and try again a few times before giving up.
  for (let i = 0; res.status === 429 && i < 3; i++) {
    await sleep(4000 + i * 4000);
    res = await post();
  }
  let reply = (await res.json().catch(() => ({}))) as ApiReply;
  if (res.status === 401 || res.status === 403) throw new Error("Roblox rejected this API key for this game. It needs the universe.analytics:read permission with the game added under Access Permissions.");
  if (res.status === 429) throw new Error("Roblox is rate-limiting this key (30 queries a minute). Wait a minute and refresh.");
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

/** One metric, cached for an hour so reopening a page does not re-query Roblox. */
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
  { id: "DailyActiveUsers", label: "Daily players", group: "Engagement", format: "int", agg: "avg", goodWhen: "up", help: "Average unique players per day" },
  { id: "Visits", label: "Visits", group: "Engagement", format: "int", agg: "sum", goodWhen: "up", help: "Sessions started in the period" },
  { id: "AveragePlayTimeMinutesPerDAU", label: "Playtime per player", group: "Engagement", format: "min", agg: "avg", goodWhen: "up", help: "Minutes played per active player per day" },
  { id: "AverageSessionLengthMinutes", label: "Session length", group: "Engagement", format: "min", agg: "avg", goodWhen: "up", help: "Average length of one session" },
  { id: "PeakConcurrentPlayers", label: "Peak players at once", group: "Engagement", format: "int", agg: "max", goodWhen: "up", perf: true, help: "Highest number online at the same time (last 28 days at most)" },
  { id: "ForwardD1Retention", label: "Day 1 retention", group: "Retention", format: "pct", agg: "avg", goodWhen: "up", help: "New players who come back the next day" },
  { id: "ForwardD7Retention", label: "Day 7 retention", group: "Retention", format: "pct", agg: "avg", goodWhen: "up", help: "New players who come back a week later" },
  { id: "DauMauStickiness", label: "Stickiness", group: "Retention", format: "pct", agg: "avg", goodWhen: "up", help: "Share of the month's players who play on a given day (DAU / MAU)" },
  { id: "DailyRevenue", label: "Revenue", group: "Money", format: "robux", agg: "sum", goodWhen: "up", help: "Robux earned in the period" },
  { id: "PayingUsers", label: "Paying players", group: "Money", format: "int", agg: "sum", goodWhen: "up", help: "Players who bought something, summed over days" },
  { id: "PayingUsersCVR", label: "Payer conversion", group: "Money", format: "pct", agg: "avg", goodWhen: "up", help: "Share of daily players who spend" },
  { id: "AverageRevenuePerPayingUser", label: "Revenue per payer", group: "Money", format: "robux", agg: "avg", goodWhen: "up", help: "Average Robux per paying player per day" },
  { id: "UniqueUsersWithImpressions", label: "Saw the game", group: "Acquisition", format: "int", agg: "sum", goodWhen: "up", help: "Players shown your game's tile on Roblox" },
  { id: "UniqueUsersWithClicks", label: "Clicked", group: "Acquisition", format: "int", agg: "sum", goodWhen: "up", help: "Players who clicked through to the game page" },
  { id: "UniqueUsersWithPlaySessions", label: "Played", group: "Acquisition", format: "int", agg: "sum", goodWhen: "up", help: "Players who started a session" },
  { id: "QualifiedUniqueUsersWithPlaySessions", label: "Stayed (qualified)", group: "Acquisition", format: "int", agg: "sum", goodWhen: "up", help: "Players who joined and stayed past Roblox's qualifying threshold" },
  { id: "ClientCrashRate15m", label: "Crash rate", group: "Performance", format: "pct", agg: "avg", goodWhen: "down", perf: true, help: "Share of sessions that crash within 15 minutes" },
  { id: "ClientFpsP50", label: "Frame rate (median)", group: "Performance", format: "fps", agg: "avg", goodWhen: "up", perf: true, help: "Median frame rate on players' devices" },
  { id: "ServerFrameRateAvg", label: "Server frame rate", group: "Performance", format: "fps", agg: "avg", goodWhen: "up", perf: true, help: "Average server heartbeat; 60 is healthy" },
];

export type MetricResult = {
  def: MetricDef;
  current: number | null;
  previous: number | null;
  changePct: number | null;
  series: { t: number; v: number }[];
  prevSeries: { t: number; v: number }[];
  error?: string;
};
export type Segment = { name: string; value: number; share: number };
export type SegmentSet = { rows: Segment[]; total: number; error?: string };

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
    "SELECT g.universe_id, g.name, g.key_id, k.api_key, k.label FROM my_games g JOIN rbx_keys k ON k.id = g.key_id WHERE g.universe_id = ? AND g.owner_id = ?",
    [universeId, await uidNow()],
  );
  return r[0] ? { ...r[0], api_key: decryptSecret(r[0].api_key) } : null;
}

const NICE: Record<string, string> = {
  RAQI_RESERVED_DIMENSION_VALUES_UNKNOWN: "Unknown",
  SponsoredAds: "Sponsored ads",
  HomeRecommendation: "Home recommendations",
  GamePass: "Game passes",
  DevProduct: "Developer products",
  Age21OrOver: "21+",
  Age18AndOverToUnder21: "18-20",
  Age16AndOverToUnder18: "16-17",
  Age13AndOverToUnder16: "13-15",
  Age9AndOverToUnder13: "9-12",
  AgeUnder9: "Under 9",
  AgeUnchecked: "Not verified",
};
const nice = (s: string) => NICE[s] ?? s.replace(/([a-z])([A-Z])/g, "$1 $2");

/**
 * Everything the My Game page shows: each metric for the last `days` days
 * against the `days` before, plus totals split by platform, source, country,
 * new vs returning, revenue source, product, and the session drop-off curve.
 */
export async function loadDashboard(universeId: number, days = 28) {
  const game = await getMyGame(universeId);
  if (!game) throw new Error("That game is not connected.");
  const end = new Date(nowMs());
  end.setUTCHours(0, 0, 0, 0); // today's UTC midnight, exclusive: only complete days
  const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");
  const endTs = Math.floor(end.getTime() / 1000);
  const split = endTs - days * 86400;
  const start = new Date(end.getTime() - days * 86400_000);

  const metrics = await pool(METRICS, 4, async (def): Promise<MetricResult> => {
    // Performance metrics only keep 28 days, so they have no "previous period".
    const span = def.perf ? Math.min(days, 27) : days * 2;
    const from = new Date(end.getTime() - span * 86400_000);
    try {
      const series = await queryMetric(game.api_key, universeId, { metric: def.id, granularity: "OneDay", startTime: iso(from), endTime: iso(end) });
      const points = normalize(def, series[0]?.points ?? []).sort((a, b) => a.t - b.t);
      const cur = points.filter((p) => p.t >= split);
      const prev = def.perf ? [] : points.filter((p) => p.t < split);
      const c = aggregate(cur.map((p) => p.v), def.agg);
      const p = def.perf ? null : aggregate(prev.map((x) => x.v), def.agg);
      return { def, current: c, previous: p, changePct: c != null && p != null && p !== 0 ? ((c - p) / Math.abs(p)) * 100 : null, series: cur, prevSeries: prev };
    } catch (e) {
      return { def, current: null, previous: null, changePct: null, series: [], prevSeries: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Totals per segment over the period (one query each). */
  const split1 = async (metric: string, dimension: string, opts: { top?: number; keepOrder?: boolean } = {}): Promise<SegmentSet> => {
    try {
      const series = await queryMetric(game.api_key, universeId, { metric, granularity: "None", startTime: iso(start), endTime: iso(end), breakdown: [dimension] });
      let rows = series.map((s) => ({ name: nice(s.breakdown[dimension] ?? "Unknown"), value: s.points.reduce((a, p) => a + p.v, 0) })).filter((r) => r.value > 0);
      const total = rows.reduce((a, r) => a + r.value, 0);
      if (!opts.keepOrder) rows.sort((a, b) => b.value - a.value);
      if (opts.top) rows = rows.slice(0, opts.top);
      return { total, rows: rows.map((r) => ({ ...r, share: total ? (r.value / total) * 100 : 0 })) };
    } catch (e) {
      return { total: 0, rows: [], error: e instanceof Error ? e.message : String(e) };
    }
  };

  const [platform, source, newReturning, country, revenueSource, products, survivalRaw, platformD1] = await pool<() => Promise<SegmentSet>, SegmentSet>(
    [
      () => split1("DailyActiveUsers", "Platform"),
      () => split1("DailyActiveUsers", "AcquisitionSource"),
      () => split1("DailyActiveUsers", "IsNewUser"),
      () => split1("DailyActiveUsers", "Country", { top: 10 }),
      () => split1("DailyRevenue", "RevenueSource"),
      () => split1("ItemMonetizationRevenue", "ProductKey", { top: 12 }),
      () => split1("TotalSessionsEndedInBucket", "SessionTimeBucket", { keepOrder: true }),
      async () => {
        // Day-1 retention has no period total, so average the daily values per platform.
        try {
          const series = await queryMetric(game.api_key, universeId, { metric: "ForwardD1Retention", granularity: "OneDay", startTime: iso(start), endTime: iso(end), breakdown: ["Platform"] });
          const rows = series
            .map((s) => ({ name: nice(s.breakdown.Platform ?? "Unknown"), value: aggregate(normalize({ format: "pct" }, s.points).map((p) => p.v), "avg") ?? 0, share: 0 }))
            .filter((r) => r.value > 0);
          return { total: 0, rows };
        } catch (e) {
          return { total: 0, rows: [], error: e instanceof Error ? e.message : String(e) };
        }
      },
    ],
    3,
    (fn) => fn(),
  );

  // Session drop-off: Roblox reports, per 30-second mark, how many sessions were still going.
  const marks = survivalRaw.rows.map((r) => ({ sec: Number(r.name), alive: r.value })).filter((m) => Number.isFinite(m.sec)).sort((a, b) => a.sec - b.sec);
  const started = marks[0]?.alive ?? 0;
  const survival = started ? marks.map((m) => ({ sec: m.sec, pct: Math.round((m.alive / started) * 1000) / 10 })) : [];
  const at = (sec: number) => survival.find((m) => m.sec === sec)?.pct ?? null;
  const half = survival.find((m) => m.pct <= 50)?.sec ?? null;

  return {
    game: { universe_id: Number(game.universe_id), name: game.name, keyLabel: game.label },
    days,
    metrics,
    segments: { platform, source, newReturning, country, revenueSource, products, platformD1 },
    survival: { curve: survival, sessions: started, leftBy30s: at(30) != null ? 100 - (at(30) as number) : null, leftBy2min: at(120) != null ? 100 - (at(120) as number) : null, stillAt10min: at(600), halfGoneSec: half },
    allFailed: metrics.every((m) => m.error),
    firstError: metrics.find((m) => m.error)?.error ?? null,
  };
}
export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;

/** The acquisition funnel for the period: each step and how many made it from the step before. */
export function funnel(d: Dashboard) {
  const get = (id: string) => d.metrics.find((m) => m.def.id === id)?.current ?? null;
  const steps = [
    { label: "Saw the game", value: get("UniqueUsersWithImpressions") },
    { label: "Clicked", value: get("UniqueUsersWithClicks") },
    { label: "Played", value: get("UniqueUsersWithPlaySessions") },
    { label: "Stayed", value: get("QualifiedUniqueUsersWithPlaySessions") },
    // Paying is deliberately not a funnel step: payers include returning players, and a
    // payer rate of a few percent is normal, so it would always look like a huge drop.
  ].filter((s): s is { label: string; value: number } => s.value != null && s.value > 0);
  return steps.map((s, i) => ({ ...s, ofPrevious: i ? (s.value / steps[i - 1].value) * 100 : null, ofFirst: (s.value / steps[0].value) * 100 }));
}

/** Plain-language list of what moved most against the previous period. No AI involved. */
export function whatChanged(d: Dashboard) {
  return d.metrics
    .filter((m) => m.changePct != null && m.current != null && m.previous != null && Math.abs(m.changePct) >= 5)
    .map((m) => ({ label: m.def.label, format: m.def.format, from: m.previous as number, to: m.current as number, pct: m.changePct as number, good: (m.changePct as number) > 0 === (m.def.goodWhen === "up") }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 6);
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

You receive, for the last period and the period before it: engagement, retention, monetization, acquisition and performance metrics with daily values; the acquisition funnel; where players come from; new versus returning players; platforms with their day-1 retention; top countries; revenue by source and by product; and the session drop-off curve (the share of sessions still going at each time mark).

Report two kinds of finding:
- chokepoint: a place where the numbers show players or revenue being lost. Examples of what counts: a metric that fell meaningfully against the previous period; a funnel step that loses far more than the others; almost all players coming from one source, especially paid ads, with few returning; a large share of sessions ending in the first 30 seconds or two minutes; one platform retaining far worse than the others; many impressions but few plays; crash rate or low frame rate; payer conversion falling while players hold steady; revenue resting on one or two products.
- healthy: a metric that is clearly stable or improving, worth one line so the developer knows it was checked.

Rules:
- Analytics only. You have never seen or played this game and know nothing about its content. Never say how to fix anything, never suggest features, changes, or experiments, and never guess at causes inside the game. State what the data shows and stop.
- Every finding must quote the numbers behind it, including what it is compared against (previous period, another platform, another segment, the step before).
- Judge significance by size and sample. Small daily player counts make percentages noisy: when the player base is small or the change is small, lower the confidence or leave the finding out. A change under about 5% is not a finding.
- You have no industry benchmarks, so never call a number low or high on its own. A finding needs a comparison inside this game's data: against the previous period, or between segments of the same kind (one platform against another, one source against another). Do not compare different kinds of step with each other: an impression-to-click rate, a click-to-play rate and a payer rate are naturally of very different sizes, and one being smaller than another means nothing.
- Some rates are small in every healthy game. Only a few percent of players ever pay, and only a few percent of people who see a tile click it. Never flag payer conversion, revenue per player or tile click rate for their level alone; flag them only if they fell meaningfully against the previous period or differ sharply between segments.
- The developer has dismissed some earlier findings as not real problems (listed in the data). Do not raise those again unless the numbers have clearly worsened since.
- Missing metrics are not findings. If a metric has no data, ignore it.
- Order findings by how much they matter. Report at most 6 choke-points and 4 healthy checks. If nothing is wrong, return only healthy checks.`;

export async function analyzeGame(universeId: number) {
  const dash = await loadDashboard(universeId);
  if (dash.allFailed) throw new Error(dash.firstError ?? "No analytics data could be loaded for this game.");
  const round = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  const seg = (s: SegmentSet) => s.rows.map((r) => ({ segment: r.name, value: round(r.value), share_pct: round(r.share) }));
  const payload = {
    period_days: dash.days,
    metrics: dash.metrics
      .filter((m) => !m.error && m.current != null)
      .map((m) => ({ metric: m.def.label, group: m.def.group, unit: m.def.format, better_when: m.def.goodWhen, this_period: round(m.current), previous_period: round(m.previous), change_pct: round(m.changePct), daily: m.series.map((p) => round(p.v)) })),
    funnel: funnel(dash).map((s) => ({ step: s.label, players: s.value, pct_of_previous_step: round(s.ofPrevious) })),
    players_by_source: seg(dash.segments.source),
    new_vs_returning: seg(dash.segments.newReturning),
    players_by_platform: seg(dash.segments.platform),
    day1_retention_by_platform_pct: dash.segments.platformD1.rows.map((r) => ({ platform: r.name, d1_pct: round(r.value) })),
    top_countries: seg(dash.segments.country),
    revenue_by_source: seg(dash.segments.revenueSource),
    revenue_by_product: seg(dash.segments.products),
    session_dropoff: { sessions: dash.survival.sessions, pct_gone_within_30s: round(dash.survival.leftBy30s), pct_gone_within_2min: round(dash.survival.leftBy2min), pct_still_playing_at_10min: round(dash.survival.stillAt10min), seconds_until_half_have_left: dash.survival.halfGoneSec },
  };
  const dismissed = await q<{ title: string; evidence: string }>("SELECT title, evidence FROM findings WHERE universe_id = ? AND dismissed = 1 ORDER BY id DESC LIMIT 15", [universeId]);
  const client = await getClient();
  const model = await pickModel();
  const response = await client.messages.parse({
    model,
    max_tokens: 8000,
    system: ANALYST,
    messages: [{ role: "user", content: `Analytics for the game, as JSON:\n\n${JSON.stringify({ ...payload, dismissed_by_developer_as_not_a_problem: dismissed.map((d) => `${d.title}: ${d.evidence}`) })}` }],
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
