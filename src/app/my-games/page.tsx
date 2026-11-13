import Link from "next/link";
import { Button } from "@/components/ui/button";
import { connectMyGame } from "@/app/actions";
import { GameIcon } from "@/components/game-table";
import { PageHeader, Section } from "@/components/page-parts";
import { q } from "@/lib/db";
import { iconsFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

const field = "h-8 rounded-lg bg-muted/60 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&>option]:bg-popover";

export default async function MyGamesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ error }, games, keys] = await Promise.all([
    searchParams,
    q<{ universe_id: number; name: string; label: string }>("SELECT g.universe_id, g.name, k.label FROM my_games g JOIN rbx_keys k ON k.id = g.key_id ORDER BY g.added_at DESC"),
    q<{ id: number; label: string }>("SELECT id, label FROM rbx_keys ORDER BY id"),
  ]);
  const icons = await iconsFor(games.map((g) => Number(g.universe_id)));

  return (
    <div className="mx-auto grid max-w-3xl gap-10">
      <PageHeader title="My games" subtitle="Analytics for games you own, read straight from Roblox with your own API keys." />
      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      {games.length > 0 && (
        <div className="grid gap-0.5">
          {games.map((g) => (
            <Link key={g.universe_id} href={`/my-games/${g.universe_id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
              <GameIcon url={icons.get(Number(g.universe_id))} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{g.name}</span>
                <span className="block text-xs text-muted-foreground">Key: {g.label}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <Section title="Connect a game" hint="One key per account or group; a key can cover several games">
        <form action={connectMyGame} className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Game link or ID
            <input name="ref" required placeholder="https://www.roblox.com/games/…" className={`${field} w-full max-w-md`} />
          </label>
          {keys.length > 0 && (
            <label className="grid gap-1 text-xs text-muted-foreground">
              Use a key you already added
              <select name="keyId" className={`${field} w-full max-w-md`} defaultValue="">
                <option value="">Add a new key below</option>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Name for this key
              <input name="label" placeholder="Main account, My group…" className={`${field} w-52`} />
            </label>
            <label className="grid flex-1 gap-1 text-xs text-muted-foreground">
              Roblox Open Cloud API key
              <input name="apiKey" type="password" autoComplete="off" placeholder="Paste the key" className={`${field} w-full`} />
            </label>
          </div>
          <div>
            <Button type="submit" size="sm">
              Connect
            </Button>
          </div>
        </form>
        <ol className="grid list-decimal gap-1 pl-5 text-xs leading-relaxed text-muted-foreground">
          <li>On create.roblox.com, open Open Cloud, then API Keys, and create a key (under the group, for a group-owned game).</li>
          <li>
            Under Access Permissions add the <span className="text-foreground">universe-analytics</span> API, choose your game, and tick{" "}
            <span className="text-foreground">universe.analytics:read</span>.
          </li>
          <li>Leave every other permission off, then paste the key here. It is stored in this dashboard&apos;s database and only ever sent to Roblox.</li>
        </ol>
      </Section>
    </div>
  );
}
