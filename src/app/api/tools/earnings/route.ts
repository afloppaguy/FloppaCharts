import { pollGames } from "@/lib/collector";
import { now, q } from "@/lib/db";
import { getGame } from "@/lib/queries";
import { clientIp, memoryLimit, tooMany } from "@/lib/security";

// For the earnings calculator: how many visits a game gets per day, measured
// from the tracker's own readings of its visit counter.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!memoryLimit(`earnings:${clientIp(req.headers)}`, 60, 60)) return tooMany(30);
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Pick a game." }, { status: 400 });
  let game = await getGame(id);
  if (!game) {
    await pollGames([id], "manual").catch(() => 0);
    game = await getGame(id);
  }
  if (!game) return Response.json({ error: "Roblox returned no public game for that." }, { status: 404 });

  const t = now();
  const snaps = await q<{ ts: number; visits: number }>("SELECT ts, visits FROM snapshots WHERE universe_id = ? AND ts >= ? AND visits IS NOT NULL ORDER BY ts", [id, t - 26 * 3600]);
  let visitsPerDay: number | null = null;
  let basis = "";
  if (snaps.length >= 2) {
    const a = snaps[0];
    const b = snaps[snaps.length - 1];
    const span = Number(b.ts) - Number(a.ts);
    if (span >= 3 * 3600 && Number(b.visits) >= Number(a.visits)) {
      visitsPerDay = Math.round(((Number(b.visits) - Number(a.visits)) / span) * 86400);
      basis = span >= 20 * 3600 ? "measured over the last 24 hours" : `measured over the last ${Math.round(span / 3600)} hours and scaled to a day`;
    }
  }
  if (visitsPerDay == null && game.visit_rate != null) {
    visitsPerDay = Math.round(game.visit_rate * 24);
    basis = "from the current hourly rate, so it swings with the time of day";
  }
  return Response.json({ id, name: game.name, playing: game.playing, visits: game.visits, visitsPerDay, basis });
}
