import { now, q } from "./db";
import type { Game } from "./queries";

// Games that went from small to notable inside a window of days. "Then" is the
// reading from the same time of day at the start of the window, so the daily
// cycle does not create fake breakouts. A game the tracker only found during
// the window is measured from the moment it was first seen.

export type Breakout = Game & { then: number; thenTs: number; sinceFound: boolean; ratio: number };

export async function getBreakouts(days: number, minNow: number, multiple: number, limit = 120): Promise<Breakout[]> {
  const t = now();
  const cut = t - days * 86400;
  const rows = await q<Game & { then_p: number | null; then_ts: number | null }>(
    `SELECT g.*, (SELECT 1 FROM watchlist w WHERE w.universe_id = g.universe_id) AS watched,
       (SELECT s.playing FROM snapshots s WHERE s.universe_id = g.universe_id AND s.ts <= ? AND s.ts >= ? AND s.playing IS NOT NULL ORDER BY s.ts DESC LIMIT 1) AS then_p,
       (SELECT s.ts FROM snapshots s WHERE s.universe_id = g.universe_id AND s.ts <= ? AND s.ts >= ? AND s.playing IS NOT NULL ORDER BY s.ts DESC LIMIT 1) AS then_ts
     FROM games g WHERE g.playing >= ? AND g.last_polled >= ?`,
    [cut + 3600, cut - 2 * 86400, cut + 3600, cut - 2 * 86400, minNow, t - 12 * 3600],
  );
  const out: Breakout[] = [];
  for (const r of rows) {
    let then = r.then_p == null ? null : Number(r.then_p);
    let thenTs = Number(r.then_ts ?? 0);
    let sinceFound = false;
    if (then == null && r.p_first != null && r.first_seen > cut && t - r.first_seen >= 2 * 3600) {
      then = Number(r.p_first);
      thenTs = Number(r.first_seen);
      sinceFound = true;
    }
    if (then == null) continue;
    const ratio = r.playing / Math.max(then, 5);
    if (ratio < multiple) continue;
    out.push({ ...r, then, thenTs, sinceFound, ratio });
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, limit);
}
