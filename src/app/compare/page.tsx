import Link from "next/link";
import { Plus, X } from "lucide-react";
import { addToCompare } from "@/app/actions";
import { CompareChart, type CompareSeries } from "@/components/compare-chart";
import { GamePicker } from "@/components/game-picker";
import { GameIcon, Growth, Pace, sessionText } from "@/components/game-table";
import { PageHeader } from "@/components/page-parts";
import { now } from "@/lib/db";
import { age, likePct, num } from "@/lib/format";
import { getGame, getHistory, iconsFor, type Game } from "@/lib/queries";

export const dynamic = "force-dynamic";

const MAX = 5;

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string; error?: string }> }) {
  const sp = await searchParams;
  const ids = [...new Set((sp.ids ?? "").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0))].slice(0, MAX);
  const games = (await Promise.all(ids.map((id) => getGame(id)))).filter((g): g is Game => !!g);
  const [histories, icons] = await Promise.all([Promise.all(games.map((g) => getHistory(Number(g.universe_id), 0, 500))), iconsFor(games.map((g) => Number(g.universe_id)))]);
  const series: CompareSeries[] = games.map((g, i) => ({
    id: Number(g.universe_id),
    name: g.name,
    points: histories[i].filter((s) => s.playing != null).map((s) => ({ ts: Number(s.ts), playing: s.playing as number })),
  }));
  const without = (id: number) => `/compare?ids=${games.map((g) => Number(g.universe_id)).filter((x) => x !== id).join(",")}`;
  const rows: { label: string; cell: (g: Game) => React.ReactNode }[] = [
    { label: "Playing now", cell: (g) => num(g.playing) },
    { label: "Growth", cell: (g) => <Growth g={g} /> },
    { label: "Pace vs lifetime", cell: (g) => <Pace value={g.pace} /> },
    { label: "Est. session", cell: (g) => sessionText(g.est_session_min) },
    { label: "Like ratio", cell: (g) => (likePct(g.up_votes, g.down_votes) != null ? `${likePct(g.up_votes, g.down_votes)}%` : "–") },
    { label: "Visits", cell: (g) => num(g.visits) },
    { label: "Favorites per 1K visits", cell: (g) => (g.visits > 0 ? ((g.favorites / g.visits) * 1000).toFixed(1) : "–") },
    { label: "Peak seen", cell: (g) => num(g.peak_playing) },
    { label: "Age", cell: (g) => age(g.created_at) },
    { label: "Genre", cell: (g) => g.genre_l2 || g.genre_l1 || "–" },
  ];

  return (
    <div className="mx-auto grid max-w-[100rem] gap-8">
      <PageHeader title="Compare" subtitle={`Up to ${MAX} games side by side`}>
        {games.length < MAX && (
          <form action={addToCompare} className="flex items-center">
            <input type="hidden" name="ids" value={games.map((g) => g.universe_id).join(",")} />
            <GamePicker placeholder="Add a game: type its name" className="w-64" required submitOnPick />
            <button type="submit" aria-label="Add to comparison" className="ml-1 inline-flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <Plus className="size-4" />
            </button>
          </form>
        )}
      </PageHeader>
      {sp.error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{sp.error}</p>}

      {games.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Add a game above, or open any game and choose Compare.</p>
      ) : (
        <>
          <CompareChart series={series} nowTs={now()} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="w-44" />
                  {games.map((g) => (
                    <th key={g.universe_id} className="px-3 pb-3 text-left font-normal">
                      <div className="flex items-center gap-2">
                        <GameIcon url={icons.get(Number(g.universe_id))} size={32} />
                        <Link href={`/games/${g.universe_id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                          {g.name}
                        </Link>
                        <Link href={without(Number(g.universe_id))} aria-label={`Remove ${g.name}`} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                          <X className="size-3.5" />
                        </Link>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-border/60">
                    <td className="py-2 text-xs text-muted-foreground">{r.label}</td>
                    {games.map((g) => (
                      <td key={g.universe_id} className="px-3 py-2 tabular-nums">
                        {r.cell(g)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
