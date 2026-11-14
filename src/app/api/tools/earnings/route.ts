import { estimateGame, saveGame, unsaveGame } from "@/lib/earnings";
import { uidNow } from "@/lib/scope";
import { clientIp, memoryLimit, tooMany } from "@/lib/security";

// The earnings calculator's list of games. POST adds a game to your list and
// returns its visits per day; DELETE takes it off the list.

export const dynamic = "force-dynamic";

const idOf = (req: Request) => {
  const id = Number(new URL(req.url).searchParams.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
};

export async function POST(req: Request) {
  if (!memoryLimit(`earnings:${clientIp(req.headers)}`, 60, 60)) return tooMany(30);
  const id = idOf(req);
  if (!id) return Response.json({ error: "Pick a game." }, { status: 400 });
  const game = await estimateGame(id);
  if (!game) return Response.json({ error: "Roblox returned no public game for that." }, { status: 404 });
  await saveGame(await uidNow(), id);
  return Response.json(game);
}

export async function DELETE(req: Request) {
  if (!memoryLimit(`earnings:${clientIp(req.headers)}`, 60, 60)) return tooMany(30);
  const id = idOf(req);
  if (!id) return Response.json({ error: "Pick a game." }, { status: 400 });
  await unsaveGame(await uidNow(), id);
  return Response.json({ ok: true });
}
