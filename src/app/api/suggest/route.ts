import { q } from "@/lib/db";
import { getNiches } from "@/lib/niches";
import { iconsFor } from "@/lib/queries";
import { uidNow } from "@/lib/scope";
import { clientIp, memoryLimit, tooMany } from "@/lib/security";

// Suggestions shown under the search box as you type: matching games (with
// icons) and matching title keywords with how many games use them.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!memoryLimit(`suggest:${clientIp(req.headers)}`, 240, 60)) return tooMany(30);
  // Suggest for the word being typed: the part after the last comma.
  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const term = raw.split(",").pop()!.trim().toLowerCase().slice(0, 60);
  if (term.length < 2) return Response.json({ games: [], keywords: [] });

  const [games, niches, ideas] = await Promise.all([
    q<{ universe_id: number; name: string; playing: number; genre_l1: string | null; genre_l2: string | null }>(
      `SELECT universe_id, name, playing, genre_l1, genre_l2 FROM games
       WHERE last_polled IS NOT NULL AND name LIKE ?
       ORDER BY (name LIKE ?) DESC, playing DESC LIMIT 6`,
      [`%${term}%`, `${term}%`],
    ),
    getNiches("keyword"),
    q<{ id: number; title: string; grade: string | null }>("SELECT id, COALESCE(idea_name, title) AS title, grade FROM chats WHERE user_id = ? AND (title LIKE ? OR idea_name LIKE ?) ORDER BY updated_at DESC LIMIT 3", [await uidNow(), `%${term}%`, `%${term}%`]),
  ]);
  const icons = await iconsFor(games.map((g) => Number(g.universe_id)));
  const keywords = niches
    .filter((n) => n.term.split(" ").some((w) => w.startsWith(term)))
    .sort((a, b) => Number(b.term.startsWith(term)) - Number(a.term.startsWith(term)) || b.games - a.games)
    .slice(0, 5)
    .map((n) => ({ term: n.term, games: n.games, hot: n.hot }));

  return Response.json({
    games: games.map((g) => ({ id: Number(g.universe_id), name: g.name, playing: g.playing, genre: g.genre_l2 || g.genre_l1, icon: icons.get(Number(g.universe_id)) ?? null })),
    keywords,
    ideas: ideas.map((c) => ({ id: Number(c.id), title: c.title, grade: c.grade })),
  });
}
