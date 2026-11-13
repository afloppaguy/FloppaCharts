import { q } from "@/lib/db";
import { growth, likePct } from "@/lib/format";
import { baseline, iconsFor, type Game } from "@/lib/queries";
import { clientIp, memoryLimit, tooMany } from "@/lib/security";

// Compact game cards for rows embedded in AI replies and briefings.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!memoryLimit(`cards:${clientIp(req.headers)}`, 240, 60)) return tooMany(30);
  const ids = [...new Set((new URL(req.url).searchParams.get("ids") ?? "").slice(0, 400).split(",").map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 12);
  if (!ids.length) return Response.json({ games: [] });
  const [rows, icons] = await Promise.all([q<Game>(`SELECT * FROM games WHERE universe_id IN (${ids.join(",")})`), iconsFor(ids)]);
  const byId = new Map(rows.map((g) => [Number(g.universe_id), g]));
  const games = ids
    .map((id) => byId.get(id))
    .filter((g): g is Game => !!g)
    .map((g) => {
      const b = baseline(g);
      const gr = b ? growth(g.playing, b.value) : null;
      return {
        id: Number(g.universe_id),
        name: g.name,
        playing: g.playing,
        icon: icons.get(Number(g.universe_id)) ?? null,
        like: likePct(g.up_votes, g.down_votes),
        growth: gr && !gr.flat ? { text: gr.text, up: gr.up } : null,
        pace: g.pace,
      };
    });
  return Response.json({ games });
}
