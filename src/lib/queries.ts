import type { InValue } from "@libsql/client";
import { kvGet, now, q } from "./db";
import { getIcons } from "./roblox";

export type Game = {
  universe_id: number;
  root_place_id: number | null;
  name: string;
  description: string | null;
  creator_id: number | null;
  creator_name: string | null;
  creator_type: string | null;
  genre_l1: string | null;
  genre_l2: string | null;
  max_players: number | null;
  created_at: number | null;
  updated_at: number | null;
  playing: number;
  visits: number;
  favorites: number;
  up_votes: number;
  down_votes: number;
  peak_playing: number;
  p_first: number | null;
  p_1h: number | null;
  p_24h: number | null;
  p_7d: number | null;
  rise_score: number;
  visit_rate: number | null; // visits per hour right now
  pace: number | null; // visit rate against the game's lifetime average (2 = twice its usual pace)
  est_session_min: number | null; // players online / visits per minute
  charts: string;
  source: string;
  first_seen: number;
  last_polled: number | null;
  backfilled: number;
  watched?: number | null;
};

export type Filters = {
  q?: string;
  min?: number;
  max?: number;
  maxAge?: number; // days since creation
  updatedWithin?: number; // days since the developer last published an update
  genre?: string;
  sub?: string; // Roblox sub-genre (genre_l2), falling back to the top-level genre
  minLike?: number; // percent
  chart?: string;
  tag?: string;
  watch?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
};

const SORTS: Record<string, string> = {
  rise: "g.rise_score DESC",
  g24: "CASE WHEN g.p_24h IS NULL THEN -1e9 ELSE (g.playing - g.p_24h) * 1.0 / MAX(g.p_24h, 10) END DESC",
  g7d: "CASE WHEN g.p_7d IS NULL THEN -1e9 ELSE (g.playing - g.p_7d) * 1.0 / MAX(g.p_7d, 10) END DESC",
  fall: "g.rise_score ASC",
  seen: "g.first_seen DESC",
  pace: "COALESCE(g.pace, -1) DESC",
  session: "COALESCE(g.est_session_min, -1) DESC",
  playing: "g.playing DESC",
  new: "g.created_at DESC",
  like: "g.up_votes * 1.0 / MAX(g.up_votes + g.down_votes, 1) DESC",
  visits: "g.visits DESC",
  updated: "g.updated_at DESC",
};
export const SORT_LABELS: Record<string, string> = {
  rise: "Rising fastest",
  g24: "24h growth %",
  g7d: "7d growth %",
  fall: "Falling fastest",
  seen: "Newly spotted",
  pace: "Pace vs lifetime",
  session: "Longest sessions",
  playing: "Most players",
  new: "Newest",
  like: "Like ratio",
  visits: "Most visits",
  updated: "Recently updated",
};

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const n = (k: string) => (s(k) != null && s(k) !== "" && !Number.isNaN(Number(s(k))) ? Number(s(k)) : undefined);
  return {
    q: s("q") || undefined,
    min: n("min"),
    max: n("max"),
    maxAge: n("maxAge"),
    updatedWithin: n("updatedWithin"),
    genre: s("genre") || undefined,
    sub: s("sub") || undefined,
    minLike: n("minLike"),
    chart: s("chart") || undefined,
    tag: s("tag") || undefined,
    watch: s("watch") === "1",
    sort: s("sort") || undefined,
    page: n("page"),
  };
}

export async function listGames(f: Filters): Promise<{ games: Game[]; total: number }> {
  const where: string[] = ["g.last_polled IS NOT NULL"];
  const args: InValue[] = [];
  if (f.q) {
    where.push("(g.name LIKE ? OR g.creator_name LIKE ?)");
    args.push(`%${f.q}%`, `%${f.q}%`);
  }
  if (f.min != null) { where.push("g.playing >= ?"); args.push(f.min); }
  if (f.max != null) { where.push("g.playing <= ?"); args.push(f.max); }
  if (f.maxAge != null) { where.push("g.created_at >= ?"); args.push(now() - f.maxAge * 86400); }
  if (f.updatedWithin != null) { where.push("g.updated_at >= ?"); args.push(now() - f.updatedWithin * 86400); }
  if (f.genre) { where.push("g.genre_l1 = ?"); args.push(f.genre); }
  if (f.sub) { where.push("COALESCE(NULLIF(g.genre_l2, ''), g.genre_l1) = ?"); args.push(f.sub); }
  if (f.minLike != null) {
    where.push("(g.up_votes + g.down_votes) >= 20 AND g.up_votes * 100.0 / (g.up_votes + g.down_votes) >= ?");
    args.push(f.minLike);
  }
  if (f.chart) { where.push("g.charts LIKE ?"); args.push(`%"${f.chart}"%`); }
  if (f.tag) { where.push("EXISTS (SELECT 1 FROM tags t WHERE t.universe_id = g.universe_id AND t.tag = ?)"); args.push(f.tag); }
  if (f.watch) where.push("EXISTS (SELECT 1 FROM watchlist w WHERE w.universe_id = g.universe_id)");
  const w = where.join(" AND ");
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(f.page ?? 1, 1);
  const order = SORTS[f.sort ?? "rise"] ?? SORTS.rise;
  const [games, total] = await Promise.all([
    q<Game>(
      `SELECT g.*, (SELECT 1 FROM watchlist w WHERE w.universe_id = g.universe_id) AS watched
       FROM games g WHERE ${w} ORDER BY ${order}, g.playing DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    ),
    q<{ n: number }>(`SELECT COUNT(*) AS n FROM games g WHERE ${w}`, args),
  ]);
  return { games, total: Number(total[0].n) };
}

export async function getGame(id: number): Promise<Game | null> {
  const r = await q<Game>(
    "SELECT g.*, (SELECT 1 FROM watchlist w WHERE w.universe_id = g.universe_id) AS watched FROM games g WHERE g.universe_id = ?",
    [id],
  );
  return r[0] ?? null;
}

export type Snapshot = { ts: number; playing: number | null; visits: number | null; favorites: number | null; up_votes: number | null; down_votes: number | null; src: string };

export async function getHistory(id: number, sinceTs = 0, maxPoints = 700): Promise<Snapshot[]> {
  const rows = await q<Snapshot>(
    "SELECT ts, playing, visits, favorites, up_votes, down_votes, src FROM snapshots WHERE universe_id = ? AND ts >= ? ORDER BY ts",
    [id, sinceTs],
  );
  if (rows.length <= maxPoints) return rows;
  const step = rows.length / maxPoints;
  const out: Snapshot[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(rows[Math.floor(i * step)]);
  out.push(rows[rows.length - 1]);
  return out;
}

export async function getGenres(): Promise<{ genre: string; n: number }[]> {
  return q("SELECT genre_l1 AS genre, COUNT(*) AS n FROM games WHERE genre_l1 IS NOT NULL AND genre_l1 != '' AND playing >= 10 GROUP BY genre_l1 ORDER BY n DESC");
}

export async function getTags(id: number) {
  return q<{ tag: string; src: string }>("SELECT tag, src FROM tags WHERE universe_id = ? ORDER BY tag", [id]);
}

export async function getNote(id: number) {
  const r = await q<{ body: string; updated_at: number }>("SELECT body, updated_at FROM notes WHERE universe_id = ?", [id]);
  return r[0] ?? null;
}

export async function getPresets() {
  return q<{ id: number; name: string; description: string | null; filters: string; src: string }>("SELECT * FROM presets ORDER BY id");
}

export async function getAlerts(limit = 100) {
  return q<{ id: number; universe_id: number | null; kind: string; message: string; ts: number; read: number }>(
    "SELECT * FROM alerts ORDER BY ts DESC LIMIT ?",
    [limit],
  );
}

export async function getStatus() {
  const [counts, snaps, last, unread] = await Promise.all([
    q<{ total: number; active: number; hot: number }>(
      "SELECT COUNT(*) AS total, SUM(playing >= 10) AS active, SUM(charts != '[]') AS hot FROM games",
    ),
    q<{ n: number; oldest: number | null }>("SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM snapshots"),
    kvGet("last_cycle"),
    q<{ n: number }>("SELECT COUNT(*) AS n FROM alerts WHERE read = 0"),
  ]);
  return {
    games: Number(counts[0].total ?? 0),
    active: Number(counts[0].active ?? 0),
    charted: Number(counts[0].hot ?? 0),
    snapshots: Number(snaps[0].n ?? 0),
    oldestSnapshot: snaps[0].oldest ? Number(snaps[0].oldest) : null,
    lastCycle: last ? (JSON.parse(last) as { ts: number; requests: number; rateLimited: number }) : null,
    unreadAlerts: Number(unread[0].n ?? 0),
  };
}

// Game icons come from Roblox at render time and are cached in memory.
const iconCache = new Map<number, { url: string; at: number }>();
export async function iconsFor(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const missing: number[] = [];
  for (const id of ids) {
    const c = iconCache.get(id);
    if (c && Date.now() - c.at < 6 * 3600_000) out.set(id, c.url);
    else missing.push(id);
  }
  if (missing.length) {
    try {
      const got = await getIcons(missing);
      for (const [id, url] of got) {
        iconCache.set(id, { url, at: Date.now() });
        out.set(id, url);
      }
    } catch {
      // icons are decoration; never fail a page over them
    }
  }
  return out;
}

/** The number a game's growth is measured against, and what that number is. */
export function baseline(g: Pick<Game, "p_24h" | "p_1h" | "p_first" | "first_seen">): { value: number; label: string } | null {
  if (g.p_24h != null) return { value: g.p_24h, label: "24h" };
  if (g.p_1h != null) return { value: g.p_1h, label: "1h" };
  if (g.p_first != null && now() - g.first_seen > 1800) return { value: g.p_first, label: "since tracked" };
  return null;
}
