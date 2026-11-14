import Link from "next/link";
import { Button } from "@/components/ui/button";
import { connectMyGame } from "@/app/actions";
import { currentView, GameIcon } from "@/components/game-table";
import { PageHeader, Section } from "@/components/page-parts";
import { ViewToggle } from "@/components/quick-actions";
import { q, run } from "@/lib/db";
import { num } from "@/lib/format";
import { iconsFor } from "@/lib/queries";
import { universeName } from "@/lib/roblox";
import { uidNow } from "@/lib/scope";

export const dynamic = "force-dynamic";

const field = "h-8 rounded-lg bg-muted/60 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&>option]:bg-popover";

type Row = { universe_id: number; name: string; label: string; playing: number | null; visits: number | null };

export default async function MyGamesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const uid = await uidNow();
  const [{ error }, games, keys, view] = await Promise.all([
    searchParams,
    q<Row>(
      `SELECT m.universe_id, m.name, k.label, g.playing, g.visits
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
  const icons = await iconsFor(games.map((g) => Number(g.universe_id)));
  const stats = (g: Row) => (g.playing != null ? `${num(g.playing)} playing · ${num(g.visits ?? 0)} visits` : "Not public yet");

  return (
    <div className="mx-auto grid max-w-5xl gap-10">
      <PageHeader title="My games" subtitle="Analytics for games you own: metrics, funnel, drop-off, sources and sales, read from Roblox with your own API keys.">
        {games.length > 0 && <ViewToggle view={view} />}
      </PageHeader>
      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

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

      <Section title="Connect a game" hint="Paste the game's link and choose which key covers it">
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
            <label className="grid flex-1 gap-1 text-xs text-muted-foreground">
              Game link or ID
              <input name="ref" required placeholder="https://www.roblox.com/games/…" className={`${field} w-full min-w-56`} />
            </label>
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
