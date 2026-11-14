import { randomUUID } from "node:crypto";
import { q } from "@/lib/db";
import { iconsFor } from "@/lib/queries";
import { searchGames } from "@/lib/roblox";
import { clientIp, memoryLimit, tooMany } from "@/lib/security";

// Finds a game by name for the "pick a game" box: tracked games first (by
// title or creator name), then Roblox's own search for anything not tracked.

export const dynamic = "force-dynamic";

type Hit = { id: number; name: string; playing: number; creator: string | null; tracked: boolean };

export async function GET(req: Request) {
  const ip = clientIp(req.headers);
  if (!memoryLimit(`game-search:${ip}`, 120, 60)) return tooMany(30);
  const term = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (term.length < 2) return Response.json({ games: [] });

  const tracked = await q<{ universe_id: number; name: string; playing: number; creator_name: string | null }>(
    `SELECT universe_id, name, playing, creator_name FROM games
     WHERE name LIKE ? OR creator_name LIKE ?
     ORDER BY (name LIKE ?) DESC, playing DESC LIMIT 8`,
    [`%${term}%`, `${term}%`, `${term}%`],
  );
  const hits: Hit[] = tracked.map((g) => ({ id: Number(g.universe_id), name: g.name, playing: Number(g.playing), creator: g.creator_name, tracked: true }));

  // Roblox's search is rate-limited, so it is only asked when the tracker has few matches.
  if (hits.length < 5 && term.length >= 3 && memoryLimit(`game-search-rbx:${ip}`, 20, 60)) {
    try {
      const seen = new Set(hits.map((h) => h.id));
      for (const r of (await searchGames(term, randomUUID(), 1)).slice(0, 8)) {
        if (!seen.has(r.universeId)) hits.push({ id: r.universeId, name: r.name, playing: r.playerCount ?? 0, creator: null, tracked: false });
      }
    } catch {
      // Roblox search is a bonus; tracked matches are still returned.
    }
  }
  const games = hits.slice(0, 10);
  const icons = await iconsFor(games.map((g) => g.id)).catch(() => new Map<number, string>());
  return Response.json({ games: games.map((g) => ({ ...g, icon: icons.get(g.id) ?? null })) });
}
