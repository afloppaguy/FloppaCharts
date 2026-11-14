import Link from "next/link";
import { Plus, X } from "lucide-react";
import { addRival, removeRival } from "@/app/actions";
import { CompareChart, type CompareSeries } from "@/components/compare-chart";
import { GamePicker } from "@/components/game-picker";
import { GameIcon, Growth, Pace, sessionText } from "@/components/game-table";
import { Section } from "@/components/page-parts";
import { now, q } from "@/lib/db";
import { age, likePct, num } from "@/lib/format";
import { getGame, getHistory, iconsFor, type Game } from "@/lib/queries";
import { similarGames } from "@/lib/related";

export const MAX_RIVALS = 4;

/** Your game next to the competitors you picked, on public numbers. */
export async function Rivals({ id, error }: { id: number; error?: string }) {
  const [mine, rivalRows] = await Promise.all([getGame(id), q<{ rival_id: number }>("SELECT rival_id FROM rivals WHERE game_id = ? ORDER BY added_at", [id])]);
  const rivals = (await Promise.all(rivalRows.map((r) => getGame(Number(r.rival_id))))).filter((g): g is Game => !!g);
  const all = mine ? [mine, ...rivals] : rivals;
  const taken = new Set(all.map((g) => Number(g.universe_id)));
  const [histories, suggestions] = await Promise.all([
    Promise.all(all.map((g) => getHistory(Number(g.universe_id), 0, 500))),
    mine && rivals.length < MAX_RIVALS ? similarGames(mine, 10).then((s) => s.filter((g) => !taken.has(Number(g.universe_id))).slice(0, 5)) : Promise.resolve([] as Game[]),
  ]);
  const icons = await iconsFor([...all, ...suggestions].map((g) => Number(g.universe_id)));
  const series: CompareSeries[] = all.map((g, i) => ({
    id: Number(g.universe_id),
    name: g.name,
    points: histories[i].filter((s) => s.playing != null).map((s) => ({ ts: Number(s.ts), playing: s.playing as number })),
  }));
  const like = (g: Game) => (likePct(g.up_votes, g.down_votes) != null ? `${likePct(g.up_votes, g.down_votes)}%` : "–");

  return (
    <Section title="Against competitors" hint="Public numbers for your game and up to four rivals">
      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      {!mine && <p className="text-sm text-muted-foreground">Your game has no public page yet, so only the rivals are shown.</p>}

      {rivals.length < MAX_RIVALS && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <form action={addRival} className="flex items-center gap-1.5">
            <input type="hidden" name="game" value={id} />
            <GamePicker placeholder="Add a rival: type its name" className="w-72" required />
            <button type="submit" aria-label="Add rival" className="inline-flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <Plus className="size-4" />
            </button>
          </form>
          {suggestions.length > 0 && <span className="text-xs text-muted-foreground">Similar games:</span>}
          {suggestions.map((g) => (
            <form key={g.universe_id} action={addRival}>
              <input type="hidden" name="game" value={id} />
              <input type="hidden" name="ref" value={`universe:${g.universe_id}`} />
              <button type="submit" title={`Add ${g.name} (${num(g.playing)} playing)`} className="flex max-w-48 items-center gap-1.5 rounded-full bg-muted/60 py-0.5 pr-2.5 pl-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                <GameIcon url={icons.get(Number(g.universe_id))} size={20} className="rounded-full" />
                <span className="truncate">{g.name}</span>
              </button>
            </form>
          ))}
        </div>
      )}

      {rivals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add a rival to see your players, growth and like ratio next to theirs over time.</p>
      ) : (
        <>
          <CompareChart series={series} nowTs={now()} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Game</th>
                  <th className="pb-2 text-right font-normal">Playing</th>
                  <th className="pb-2 text-right font-normal">Growth</th>
                  <th className="pb-2 text-right font-normal">Pace</th>
                  <th className="pb-2 text-right font-normal">Session</th>
                  <th className="pb-2 text-right font-normal">Likes</th>
                  <th className="pb-2 text-right font-normal" title="Favorites per 1,000 visits">
                    Favs / 1K
                  </th>
                  <th className="pb-2 text-right font-normal">Age</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {all.map((g) => {
                  const own = Number(g.universe_id) === id;
                  return (
                    <tr key={g.universe_id} className={`border-t border-border/60 ${own ? "bg-sky-500/5" : ""}`}>
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <GameIcon url={icons.get(Number(g.universe_id))} size={28} />
                          <Link href={`/games/${g.universe_id}`} className="max-w-64 truncate font-medium hover:underline">
                            {g.name}
                          </Link>
                          {own && <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">yours</span>}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{num(g.playing)}</td>
                      <td className="py-2 text-right">
                        <Growth g={g} />
                      </td>
                      <td className="py-2 text-right">
                        <Pace value={g.pace} />
                      </td>
                      <td className="py-2 text-right tabular-nums">{sessionText(g.est_session_min)}</td>
                      <td className="py-2 text-right tabular-nums">{like(g)}</td>
                      <td className="py-2 text-right tabular-nums">{g.visits > 0 ? ((g.favorites / g.visits) * 1000).toFixed(1) : "–"}</td>
                      <td className="py-2 text-right text-muted-foreground tabular-nums">{age(g.created_at)}</td>
                      <td className="py-2 text-right">
                        {!own && (
                          <form action={removeRival}>
                            <input type="hidden" name="game" value={id} />
                            <input type="hidden" name="rival" value={Number(g.universe_id)} />
                            <button type="submit" aria-label={`Remove ${g.name}`} className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                              <X className="size-3.5" />
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
