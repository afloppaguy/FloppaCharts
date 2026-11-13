import { randomUUID } from "node:crypto";
import type { InStatement } from "@libsql/client";
import { db, kvGet, kvSet, now, q, ready, run } from "./db";
import { getCharts, getDetails, getVotes, stats, type ChartGame, type GameDetail } from "./roblox";

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const iso = (s: string) => Math.floor(Date.parse(s) / 1000) || null;

// Extra chart views crawled in rotation: the same lists look different per
// device and country, which is how games rising in one market get found.
const DEVICES = ["high_end_phone", "low_end_phone", "console", "high_end_tablet", "computer", "vr"];
const COUNTRIES = ["us", "br", "ph", "gb", "mx", "id", "de", "fr", "jp", "kr", "in", "tr", "ru", "vn", "th", "es", "it", "pl", "ca", "au", "ar", "co", "sa", "eg", "my"];

/** How often a game is re-polled, by how interesting it currently is. */
function pollInterval(g: { watched: boolean; inCharts: boolean; playing: number; visits: number; score: number; createdAt: number | null }) {
  if (g.watched || g.inCharts || g.playing >= 1000 || g.score >= 5) return 14 * 60;
  if (g.playing >= 100) return 3600;
  if (g.playing >= 10) return 6 * 3600;
  const ageDays = g.createdAt ? (now() - g.createdAt) / 86400 : 0;
  if (g.playing === 0 && g.visits < 1000 && ageDays > 14) return 7 * 86400;
  return 86400;
}

export function riseScore(playing: number, base: number | null) {
  if (base == null) return 0;
  return Math.round(((playing - base) / Math.sqrt(Math.max(base, 25))) * 100) / 100;
}

/** Crawl chart lists; insert games not seen before and refresh chart membership. */
export async function discoverCharts(extraViews = 2) {
  const session = randomUUID();
  const t = now();
  const seen = new Map<number, { g: ChartGame; sorts: Set<string> }>();
  const primary = new Set<number>();

  const views: [string, string, boolean][] = [["computer", "all", true]];
  const idx = Number((await kvGet("view_idx")) ?? "0");
  for (let i = 0; i < extraViews; i++) {
    const n = idx + i;
    views.push([DEVICES[n % DEVICES.length], COUNTRIES[n % COUNTRIES.length], false]);
  }
  await kvSet("view_idx", String(idx + extraViews));

  for (const [device, country, isPrimary] of views) {
    try {
      const charts = await getCharts(session, device, country);
      for (const c of charts) {
        for (const game of c.games) {
          const e = seen.get(game.universeId) ?? { g: game, sorts: new Set<string>() };
          if (isPrimary) {
            e.sorts.add(c.sortId);
            primary.add(game.universeId);
          }
          seen.set(game.universeId, e);
        }
      }
    } catch (e) {
      log("chart view failed", device, country, String(e).slice(0, 120));
    }
  }

  const ids = [...seen.keys()];
  const existing = new Map<number, { charts: string; charts_seen: number | null }>();
  for (const part of chunk(ids, 400)) {
    const rows = await q<{ universe_id: number; charts: string; charts_seen: number | null }>(
      `SELECT universe_id, charts, charts_seen FROM games WHERE universe_id IN (${part.join(",")})`,
    );
    for (const r of rows) existing.set(Number(r.universe_id), r);
  }

  const stmts: InStatement[] = [];
  let added = 0;
  for (const [id, { g, sorts }] of seen) {
    const charts = JSON.stringify([...sorts].sort());
    const ex = existing.get(id);
    if (!ex) {
      added++;
      stmts.push({
        sql: `INSERT INTO games (universe_id, root_place_id, name, genre_l1, playing, up_votes, down_votes, peak_playing, p_first, charts, charts_seen, source, first_seen, next_poll)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'charts', ?, 0)`,
        args: [id, g.rootPlaceId ?? null, g.name ?? "", g.genreL1 ?? null, g.playerCount ?? 0, g.totalUpVotes ?? 0, g.totalDownVotes ?? 0, g.playerCount ?? 0, g.playerCount ?? 0, charts, t, t],
      });
    } else if (primary.has(id) && (ex.charts !== charts || (ex.charts_seen ?? 0) < t - 3600)) {
      stmts.push({ sql: "UPDATE games SET charts = ?, charts_seen = ?, next_poll = MIN(next_poll, ?) WHERE universe_id = ?", args: [charts, t, t + 900, id] });
    }
  }
  // Games that fell off every chart.
  stmts.push({ sql: "UPDATE games SET charts = '[]' WHERE charts != '[]' AND charts_seen < ?", args: [t - 3 * 3600] });
  for (const part of chunk(stmts, 200)) await db().batch(part, "write");
  log(`charts: ${views.length} views, ${seen.size} games seen, ${added} new`);
  return { seen: seen.size, added };
}

type Baseline = {
  universe_id: number;
  p_first: number | null;
  first_seen: number;
  peak_playing: number;
  up_votes: number;
  down_votes: number;
  charts: string;
  watched: number;
  p1h: number | null;
  p24: number | null;
  p7d: number | null;
  prev_ts: number | null;
  prev_visits: number | null;
};

/**
 * Signals that need no long history, only two snapshots:
 *   visit_rate       visits per hour right now
 *   pace             that rate against the game's lifetime average rate (2 = twice its usual pace)
 *   est_session_min  players online divided by visits per minute: roughly how long a visit lasts
 */
function liveSignals(d: GameDetail, b: Baseline | undefined, t: number, createdAt: number | null) {
  if (!b?.prev_ts || b.prev_visits == null) return { rate: null, pace: null, session: null };
  const hours = (t - Number(b.prev_ts)) / 3600;
  const gained = d.visits - Number(b.prev_visits);
  if (hours <= 0 || gained < 0) return { rate: null, pace: null, session: null };
  const rate = gained / hours;
  const lifeHours = createdAt ? Math.max((t - createdAt) / 3600, 24) : null;
  const lifetimeRate = lifeHours ? d.visits / lifeHours : null;
  const pace = lifetimeRate && d.visits >= 1000 ? Math.min(Math.round((rate / lifetimeRate) * 100) / 100, 999) : null;
  // Too few visits in the window makes the estimate meaningless.
  const session = gained >= 20 && d.playing > 0 ? Math.min(Math.round(((d.playing * 60) / rate) * 10) / 10, 600) : null;
  return { rate: Math.round(rate * 10) / 10, pace, session };
}

/** Write fresh details for a batch of games: one row update + one snapshot each. */
async function saveDetails(details: GameDetail[], votes: Map<number, { up: number; down: number }>, source?: string) {
  if (!details.length) return;
  const t = now();
  const ids = details.map((d) => d.id);
  const base = new Map<number, Baseline>();
  const rows = await q<Baseline>(
    `SELECT g.universe_id, g.p_first, g.first_seen, g.peak_playing, g.up_votes, g.down_votes, g.charts,
            (SELECT 1 FROM watchlist w WHERE w.universe_id = g.universe_id) AS watched,
            (SELECT playing FROM snapshots s WHERE s.universe_id = g.universe_id AND s.ts BETWEEN ${t - 3 * 3600} AND ${t - 3000} ORDER BY s.ts DESC LIMIT 1) AS p1h,
            (SELECT playing FROM snapshots s WHERE s.universe_id = g.universe_id AND s.ts BETWEEN ${t - 48 * 3600} AND ${t - 23 * 3600} ORDER BY s.ts DESC LIMIT 1) AS p24,
            (SELECT playing FROM snapshots s WHERE s.universe_id = g.universe_id AND s.ts BETWEEN ${t - 10 * 86400} AND ${t - 6.5 * 86400} ORDER BY s.ts DESC LIMIT 1) AS p7d,
            (SELECT ts FROM snapshots s WHERE s.universe_id = g.universe_id AND s.visits IS NOT NULL AND s.ts BETWEEN ${t - 6 * 3600} AND ${t - 1500} ORDER BY s.ts DESC LIMIT 1) AS prev_ts,
            (SELECT visits FROM snapshots s WHERE s.universe_id = g.universe_id AND s.visits IS NOT NULL AND s.ts BETWEEN ${t - 6 * 3600} AND ${t - 1500} ORDER BY s.ts DESC LIMIT 1) AS prev_visits
     FROM games g WHERE g.universe_id IN (${ids.join(",")})`,
  );
  for (const r of rows) base.set(Number(r.universe_id), r);

  const stmts: InStatement[] = [];
  for (const d of details) {
    const b = base.get(d.id);
    const v = votes.get(d.id);
    const createdAt = iso(d.created);
    const pFirst = b?.p_first ?? d.playing;
    const firstSeenAgo = b ? t - Number(b.first_seen) : 0;
    const baseline = b?.p24 ?? b?.p1h ?? (firstSeenAgo > 1800 ? pFirst : null);
    const score = riseScore(d.playing, baseline);
    const inCharts = !!b && b.charts !== "[]";
    const next = t + pollInterval({ watched: !!b?.watched, inCharts, playing: d.playing, visits: d.visits, score, createdAt });
    const peak = Math.max(b?.peak_playing ?? 0, d.playing);
    const live = liveSignals(d, b, t, createdAt);

    stmts.push({
      sql: `INSERT INTO games (universe_id, root_place_id, name, description, creator_id, creator_name, creator_type, genre_l1, genre_l2, max_players,
              created_at, updated_at, playing, visits, favorites, up_votes, down_votes, peak_playing, p_first, p_1h, p_24h, p_7d, rise_score,
              source, first_seen, last_polled, next_poll, visit_rate, pace, est_session_min)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(universe_id) DO UPDATE SET
              root_place_id = excluded.root_place_id, name = excluded.name, description = excluded.description,
              creator_id = excluded.creator_id, creator_name = excluded.creator_name, creator_type = excluded.creator_type,
              genre_l1 = COALESCE(excluded.genre_l1, genre_l1), genre_l2 = excluded.genre_l2, max_players = excluded.max_players,
              created_at = excluded.created_at, updated_at = excluded.updated_at, playing = excluded.playing, visits = excluded.visits,
              favorites = excluded.favorites,
              up_votes = excluded.up_votes, down_votes = excluded.down_votes,
              peak_playing = excluded.peak_playing, p_first = COALESCE(p_first, excluded.p_first),
              p_1h = excluded.p_1h, p_24h = excluded.p_24h, p_7d = excluded.p_7d, rise_score = excluded.rise_score,
              last_polled = excluded.last_polled, next_poll = excluded.next_poll,
              visit_rate = COALESCE(excluded.visit_rate, visit_rate), pace = COALESCE(excluded.pace, pace),
              est_session_min = COALESCE(excluded.est_session_min, est_session_min)`,
      args: [
        d.id, d.rootPlaceId, d.name ?? "", d.description ?? null, d.creator?.id ?? null, d.creator?.name ?? null, d.creator?.type ?? null,
        d.genre_l1 || null, d.genre_l2 || null, d.maxPlayers ?? null, createdAt, iso(d.updated), d.playing, d.visits, d.favoritedCount ?? 0,
        // Votes come from a separate endpoint; when it has no answer, keep what is stored.
        v?.up ?? b?.up_votes ?? 0, v?.down ?? b?.down_votes ?? 0, peak, pFirst, b?.p1h ?? null, b?.p24 ?? null, b?.p7d ?? null, score,
        source ?? "charts", t, t, next, live.rate, live.pace, live.session,
      ],
    });
    // Dead games are not worth a snapshot row every day.
    if (d.playing > 0 || !b) {
      stmts.push({
        sql: "INSERT OR REPLACE INTO snapshots (universe_id, ts, playing, visits, favorites, up_votes, down_votes, src) VALUES (?, ?, ?, ?, ?, ?, ?, 'collector')",
        args: [d.id, t, d.playing, d.visits, d.favoritedCount ?? 0, v?.up ?? null, v?.down ?? null],
      });
    }
    if (b?.watched && b.p24 != null && d.playing >= 20 && d.playing >= b.p24 * 1.5) {
      stmts.push({
        sql: `INSERT INTO alerts (universe_id, kind, message, ts)
              SELECT ?, 'surge', ?, ? WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE universe_id = ? AND kind = 'surge' AND ts > ?)`,
        args: [d.id, `${d.name} is up ${Math.round((d.playing / Math.max(b.p24, 1) - 1) * 100)}% in 24h (${b.p24} → ${d.playing} players)`, t, d.id, t - 86400],
      });
    }
  }
  await db().batch(stmts, "write");
}

/** Poll one explicit set of games right now (used by "add game" and MCP). */
export async function pollGames(ids: number[], source?: string) {
  let n = 0;
  for (const part of chunk(ids, 50)) {
    const details = await getDetails(part);
    const votes = await getVotes(part).catch(() => new Map());
    await saveDetails(details, votes, source);
    n += details.length;
  }
  return n;
}

/** Poll games whose next_poll time has passed, most overdue first. */
export async function pollDue(deadline: number) {
  let polled = 0;
  while (Date.now() < deadline) {
    const due = await q<{ universe_id: number }>("SELECT universe_id FROM games WHERE next_poll <= ? ORDER BY next_poll LIMIT 100", [now()]);
    if (!due.length) break;
    const ids = due.map((r) => Number(r.universe_id));
    const votes = await getVotes(ids).catch(() => new Map());
    for (const part of chunk(ids, 50)) {
      const details = await getDetails(part);
      await saveDetails(details, votes);
      // IDs Roblox no longer returns (deleted or private): push them far out.
      const got = new Set(details.map((d) => d.id));
      const gone = part.filter((id) => !got.has(id));
      if (gone.length) await run(`UPDATE games SET next_poll = ?, playing = 0 WHERE universe_id IN (${gone.join(",")})`, [now() + 7 * 86400]);
      polled += part.length;
      if (Date.now() > deadline) break;
    }
  }
  log(`poll: ${polled} games`);
  return polled;
}

async function createdOf(id: number): Promise<number | null> {
  const d = await getDetails(Array.from({ length: 50 }, (_, i) => id + i));
  return d.length ? iso(d[0].created) : null;
}

/** Find the universe ID that was created around a given time (IDs are sequential). */
async function findIdAtTime(target: number): Promise<number> {
  const top = await q<{ m: number }>("SELECT MAX(universe_id) AS m FROM games");
  let hi = Number(top[0]?.m ?? 0);
  if (!hi) throw new Error("no games yet; run chart discovery first");
  // Walk up to the frontier (first ID range that does not exist yet).
  const step = 500_000;
  while ((await createdOf(hi + step)) != null) hi += step;
  let lo = hi - 3_000_000;
  for (let i = 0; i < 6; i++) {
    const c = await createdOf(lo);
    if (c != null && c < target) break;
    lo -= 3_000_000;
  }
  hi += step;
  while (hi - lo > 2000) {
    const mid = Math.floor((lo + hi) / 2);
    const c = await createdOf(mid);
    if (c == null || c > target) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * Walk every newly created game once it is `lagHours` old and keep the ones
 * that found players. Roughly 170k games are created per day; almost all are
 * empty starter places and are never stored.
 */
export async function scanNew(name: string, lagHours: number, minPlaying: number, minVisits: number, deadline: number) {
  const key = `scan_${name}`;
  let cursor = Number((await kvGet(key)) ?? "0");
  if (!cursor) {
    log(`scan ${name}: locating start point`);
    cursor = await findIdAtTime(now() - lagHours * 3600);
    await kvSet(key, String(cursor));
  }
  let scanned = 0;
  let kept = 0;
  while (Date.now() < deadline) {
    const ids = Array.from({ length: 50 }, (_, i) => cursor + i);
    const details = await getDetails(ids);
    if (!details.length) break; // reached the frontier
    const newest = Math.max(...details.map((d) => iso(d.created) ?? 0));
    if (newest > now() - lagHours * 3600) break; // caught up; wait for these to age
    const keep = details.filter((d) => d.playing >= minPlaying || d.visits >= minVisits);
    if (keep.length) {
      const known = await q<{ universe_id: number }>(`SELECT universe_id FROM games WHERE universe_id IN (${keep.map((d) => d.id).join(",")})`);
      const knownIds = new Set(known.map((r) => Number(r.universe_id)));
      const fresh = keep.filter((d) => !knownIds.has(d.id));
      if (fresh.length) {
        await saveDetails(fresh, await getVotes(fresh.map((d) => d.id)).catch(() => new Map()), "scan");
        kept += fresh.length;
      }
    }
    cursor += 50;
    scanned += 50;
    if (scanned % 500 === 0) await kvSet(key, String(cursor));
  }
  await kvSet(key, String(cursor));
  log(`scan ${name}: ${scanned} IDs checked, ${kept} kept`);
  return { scanned, kept };
}

/** Thin old history so storage and the write budget stay small. */
export async function thinHistory() {
  const last = Number((await kvGet("last_thin")) ?? "0");
  if (now() - last < 86400) return;
  const t = now();
  await run("DELETE FROM snapshots WHERE src = 'collector' AND ts < ? AND (ts % 3600) >= 900", [t - 14 * 86400]);
  await run("DELETE FROM snapshots WHERE src = 'collector' AND ts < ? AND (ts % 86400) >= 3600", [t - 90 * 86400]);
  await kvSet("last_thin", String(t));
}

/** One full collection pass, bounded by a time budget in minutes. */
export async function cycle(minutes: number) {
  await ready();
  const start = Date.now();
  const end = start + minutes * 60_000;
  const at = (f: number) => start + (end - start) * f;
  await discoverCharts();
  await pollDue(at(0.55));
  await scanNew("1d", 24, 10, 1000, at(0.8));
  await scanNew("7d", 24 * 7, 10, 3000, end);
  await pollDue(end);
  await thinHistory();
  await kvSet("last_cycle", JSON.stringify({ ts: now(), requests: stats.requests, rateLimited: stats.rateLimited }));
  log(`cycle done: ${stats.requests} requests, ${stats.rateLimited} rate-limited`);
}
