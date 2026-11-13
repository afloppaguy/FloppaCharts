import type { InValue } from "@libsql/client";
import { pollGames } from "./collector";
import { kvGet, kvSet, now, q } from "./db";
import { terms } from "./niches";
import type { Game } from "./queries";
import { rbx } from "./roblox";

const WATCHED = "(SELECT 1 FROM watchlist w WHERE w.universe_id = g.universe_id) AS watched";

/**
 * Games most like this one: same Roblox sub-genre, shared title words, shared
 * tags. Scored so that a game matching on several of those ranks first.
 */
export async function similarGames(g: Game, limit = 12): Promise<Game[]> {
  const id = Number(g.universe_id);
  const sub = g.genre_l2 || g.genre_l1;
  const words = terms(g.name).filter((t) => !t.includes(" ")).slice(0, 5);
  const tags = (await q<{ tag: string }>("SELECT tag FROM tags WHERE universe_id = ?", [id])).map((t) => t.tag);

  const clauses: string[] = [];
  const args: InValue[] = [id];
  if (sub) {
    clauses.push("COALESCE(NULLIF(g.genre_l2, ''), g.genre_l1) = ?");
    args.push(sub);
  }
  for (const w of words) {
    clauses.push("g.name LIKE ?");
    args.push(`%${w}%`);
  }
  if (tags.length) clauses.push(`EXISTS (SELECT 1 FROM tags t WHERE t.universe_id = g.universe_id AND t.tag IN (${tags.map(() => "?").join(",")}))`);
  args.push(...tags);
  if (!clauses.length) return [];

  const [rows, tagRows] = await Promise.all([
    q<Game>(`SELECT g.*, ${WATCHED} FROM games g WHERE g.universe_id != ? AND g.playing >= 5 AND g.last_polled IS NOT NULL AND (${clauses.join(" OR ")}) ORDER BY g.playing DESC LIMIT 400`, args),
    tags.length ? q<{ universe_id: number; tag: string }>(`SELECT universe_id, tag FROM tags WHERE tag IN (${tags.map(() => "?").join(",")})`, tags) : Promise.resolve([]),
  ]);
  const sharedTags = new Map<number, number>();
  for (const t of tagRows) sharedTags.set(Number(t.universe_id), (sharedTags.get(Number(t.universe_id)) ?? 0) + 1);

  const wordSet = new Set(words);
  return rows
    .map((r) => {
      const theirs = terms(r.name);
      const sharedWords = theirs.filter((t) => wordSet.has(t)).length;
      const score = sharedWords * 3 + (sharedTags.get(Number(r.universe_id)) ?? 0) * 3 + ((r.genre_l2 || r.genre_l1) === sub ? 2 : 0);
      return { r, score };
    })
    .filter((x) => x.score >= 3) // sub-genre alone is too loose to call "similar"
    .sort((a, b) => b.score - a.score || b.r.playing - a.r.playing)
    .slice(0, limit)
    .map((x) => x.r);
}

export type CreatorType = "User" | "Group";

/** Ask Roblox for a creator's public games and start tracking any that are new. At most once a day per creator. */
export async function scanCreator(type: CreatorType, id: number): Promise<number> {
  const key = `creator_scan_${type}_${id}`;
  if (now() - Number((await kvGet(key)) ?? "0") < 86400) return 0;
  await kvSet(key, String(now()));
  const url =
    type === "Group"
      ? `https://games.roblox.com/v2/groups/${id}/gamesV2?accessFilter=2&limit=100&sortOrder=Desc`
      : `https://games.roblox.com/v2/users/${id}/games?accessFilter=2&limit=50&sortOrder=Desc`;
  const d = await rbx<{ data?: { id: number }[] }>(url, 2);
  const ids = (d.data ?? []).map((x) => Number(x.id)).filter(Boolean);
  if (!ids.length) return 0;
  const known = new Set((await q<{ universe_id: number }>(`SELECT universe_id FROM games WHERE universe_id IN (${ids.join(",")})`)).map((r) => Number(r.universe_id)));
  const fresh = ids.filter((x) => !known.has(x)).slice(0, 100);
  if (fresh.length) await pollGames(fresh, "creator");
  return fresh.length;
}

export async function creatorGames(type: CreatorType, id: number): Promise<Game[]> {
  return q<Game>(`SELECT g.*, ${WATCHED} FROM games g WHERE g.creator_id = ? AND g.creator_type = ? AND g.last_polled IS NOT NULL ORDER BY g.playing DESC, g.visits DESC LIMIT 200`, [id, type]);
}
