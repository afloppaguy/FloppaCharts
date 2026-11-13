import { q } from "@/lib/db";
import { likePct } from "@/lib/format";
import { iconsFor } from "@/lib/queries";
import { rbx } from "@/lib/roblox";
import { clientIp, memoryLimit, tooMany } from "@/lib/security";

// Popular games' artwork for the thumbnail tester: square icons, or the wide
// 16:9 thumbnails Roblox shows on its home page.

export const dynamic = "force-dynamic";

type Row = { universe_id: number; name: string; playing: number; up_votes: number; down_votes: number };
const wideCache = new Map<number, string>();

async function wideThumbs(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const missing = ids.filter((id) => (wideCache.has(id) ? (out.set(id, wideCache.get(id)!), false) : true));
  for (let i = 0; i < missing.length; i += 50) {
    const d = await rbx<{ data?: { universeId: number; thumbnails?: { imageUrl?: string | null }[] }[] }>(
      `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${missing.slice(i, i + 50).join(",")}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`,
      2,
    );
    for (const g of d.data ?? []) {
      const url = g.thumbnails?.[0]?.imageUrl;
      if (url) {
        wideCache.set(g.universeId, url);
        out.set(g.universeId, url);
      }
    }
  }
  return out;
}

export async function GET(req: Request) {
  if (!memoryLimit(`tiles:${clientIp(req.headers)}`, 60, 60)) return tooMany(30);
  const kind = new URL(req.url).searchParams.get("kind") === "wide" ? "wide" : "icon";
  // A random handful from the 150 most-played tracked games, so every shuffle looks like a real page.
  const top = await q<Row>("SELECT universe_id, name, playing, up_votes, down_votes FROM games WHERE last_polled IS NOT NULL ORDER BY playing DESC LIMIT 150");
  const picked = top
    .map((g) => ({ g, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, 40)
    .map((x) => x.g);
  const ids = picked.map((g) => Number(g.universe_id));
  const images = kind === "wide" ? await wideThumbs(ids).catch(() => new Map<number, string>()) : await iconsFor(ids);
  return Response.json({
    kind,
    tiles: picked
      .filter((g) => images.has(Number(g.universe_id)))
      .map((g) => ({ id: Number(g.universe_id), name: g.name, image: images.get(Number(g.universe_id)), playing: g.playing, like: likePct(g.up_votes, g.down_votes) })),
  });
}
