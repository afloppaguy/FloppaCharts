import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { connectMyGame } from "@/app/actions";
import { currentView, GameIcon } from "@/components/game-table";
import { GamePicker } from "@/components/game-picker";
import { MyGamesTotals, TOTAL_RANGES } from "@/components/my-games-totals";
import { PageHeader, Section } from "@/components/page-parts";
import { ViewToggle } from "@/components/quick-actions";
import { q, run } from "@/lib/db";
import { num } from "@/lib/format";
import { iconsFor } from "@/lib/queries";
import { creatorGames, scanCreator, type CreatorType } from "@/lib/related";
import { universeName } from "@/lib/roblox";
import { uidNow } from "@/lib/scope";

export const dynamic = "force-dynamic";

const field = "h-8 rounded-lg bg-muted/60 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&>option]:bg-popover";

type Row = { universe_id: number; name: string; key_id: number; label: string; playing: number | null; visits: number | null; creator_id: number | null; creator_type: string | null };

/** Other public games by the same creators as the connected ones, so they can be connected with one click. */
async function siblings(games: Row[]) {
  const mine = new Set(games.map((g) => Number(g.universe_id)));
  const creators = new Map<string, Row>();
  for (const g of games) if (g.creator_id && (g.creator_type === "User" || g.creator_type === "Group")) creators.set(`${g.creator_type}:${g.creator_id}`, g);
  const out: { id: number; name: string; playing: number; keyId: number }[] = [];
  for (const g of [...creators.values()].slice(0, 4)) {
    const type = g.creator_type as CreatorType;
    await scanCreator(type, Number(g.creator_id)).catch(() => 0);
    for (const s of await creatorGames(type, Number(g.creator_id))) {
      if (!mine.has(Number(s.universe_id))) out.push({ id: Number(s.universe_id), name: s.name, playing: s.playing, keyId: Number(g.key_id) });
    }
  }
  return out.slice(0, 12);
}

export default async function MyGamesPage({ searchParams }: { searchParams: Promise<{ error?: string; days?: string }> }) {
  const uid = await uidNow();
  const [{ error, days: daysParam }, games, keys, view] = await Promise.all([
    searchParams,
    q<Row>(
      `SELECT m.universe_id, m.name, m.key_id, k.label, g.playing, g.visits, g.creator_id, g.creator_type
       FROM my_games m JOIN rbx_keys k ON k.id = m.key_id LEFT JOIN games g ON g.universe_id = m.universe_id WHERE m.owner_id = ? ORDER BY m.added_at DESC`,
      [uid],
    ),
    q<{ id: number; label: string }>("SELECT id, label FROM rbx_keys WHERE owner_id = ? ORDER BY id", [uid]),
    currentView(),
  ]);
  // Games connected while Roblox was rate-limiting got a placeholder name; look the real one up once.
  for (const g of games.filter((x) => /^Game \d+$/.test(x.name))) {
    const real = await universeName(Number(g.universe_id));
    if (real) {
      g.name = real;
      await run("UPDATE my_games SET name = ? WHERE universe_id = ?", [real, Number(g.universe_id)]);
    }
  }
  const days = TOTAL_RANGES.includes(Number(daysParam)) ? Number(daysParam) : 28;
  const more = await siblings(games).catch(() => []);
  const icons = await iconsFor([...games.map((g) => Number(g.universe_id)), ...more.map((g) => g.id)]);
  const stats = (g: Row) => (g.playing != null ? `${num(g.playing)} playing · ${num(g.visits ?? 0)} visits` : "Not public yet");

  return (
    <div className="mx-auto grid max-w-5xl gap-10">
      <PageHeader title="My games" subtitle="Analytics for games you own: metrics, funnel, drop-off, sources and sales, read from Roblox with your own API keys.">
        {games.length > 0 && <ViewToggle view={view} />}
      </PageHeader>
      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      {games.length > 0 && (
        <Suspense fallback={<p className="rounded-2xl bg-muted/30 px-5 py-4 text-sm text-muted-foreground">Adding up your games…</p>}>
          <MyGamesTotals days={days} />
        </Suspense>
      )}

      {games.length > 0 && view === "grid" && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-6">
          {games.map((g) => (
            <Link key={g.universe_id} href={`/my-games/${g.universe_id}`} className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <GameIcon url={icons.get(Number(g.universe_id))} className="aspect-square w-full rounded-xl transition group-hover:brightness-110" />
              <div className="mt-2 truncate text-sm font-medium">{g.name}</div>
              <div className="truncate text-xs text-muted-foreground">{stats(g)}</div>
            </Link>
          ))}
        </div>
      )}
      {games.length > 0 && view === "list" && (
        <div className="grid gap-0.5">
          {games.map((g) => (
            <Link key={g.universe_id} href={`/my-games/${g.universe_id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
              <GameIcon url={icons.get(Number(g.universe_id))} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{g.name}</span>
                <span className="block text-xs text-muted-foreground">{stats(g)}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">Key: {g.label}</span>
            </Link>
          ))}
        </div>
      )}

      {more.length > 0 && (
        <Section title="More of your games" hint="Other public games by the same creator. One click connects them with the same key.">
          <div className="flex flex-wrap gap-2">
            {more.map((g) => (
              <form key={g.id} action={connectMyGame}>
                <input type="hidden" name="ref" value={`universe:${g.id}`} />
                <input type="hidden" name="keyId" value={g.keyId} />
                <button type="submit" title={`Connect ${g.name}`} className="flex max-w-64 items-center gap-2 rounded-xl bg-muted/40 py-1.5 pr-3 pl-1.5 text-left text-sm hover:bg-muted">
                  <GameIcon url={icons.get(g.id)} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{g.name}</span>
                    <span className="block text-xs text-muted-foreground">{num(g.playing)} playing · connect</span>
                  </span>
                </button>
              </form>
            ))}
          </div>
        </Section>
      )}

      <Section title="Connect a game" hint="Type the game's name, pick it, and choose which key covers it">
        {keys.length === 0 ? (
          <p className="rounded-xl bg-muted/40 px-4 py-4 text-sm text-muted-foreground">
            Add a Roblox API key first, in{" "}
            <Link href="/settings" className="text-foreground underline underline-offset-4">
              Settings
            </Link>
            . It takes a minute: create a key on create.roblox.com with only the <span className="text-foreground">universe.analytics:read</span> permission for your game.
          </p>
        ) : (
          <form action={connectMyGame} className="flex flex-wrap items-end gap-2">
            <div className="grid flex-1 gap-1 text-xs text-muted-foreground">
              Game
              <GamePicker placeholder="Type your game's name (or your Roblox username)" className="w-full min-w-56" required />
            </div>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Key
              <select name="keyId" className={`${field} w-48`} defaultValue={String(keys[0].id)}>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm">
              Connect
            </Button>
            <Link href="/settings" className="px-1 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              Manage keys
            </Link>
          </form>
        )}
      </Section>
    </div>
  );
}
