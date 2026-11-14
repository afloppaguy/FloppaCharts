import Link from "next/link";
import { currentView, GameIcon } from "@/components/game-table";
import { PageHeader } from "@/components/page-parts";
import { ViewToggle, WatchToggle } from "@/components/quick-actions";
import { getBreakouts, type Breakout } from "@/lib/breakouts";
import { age, ago, num } from "@/lib/format";
import { iconsFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

const WINDOWS = [1, 3, 7, 14];
const SIZES = [200, 500, 1000, 5000];
const MULTIPLES = [3, 5, 10];

const times = (r: number) => `×${r >= 100 ? Math.round(r) : r >= 10 ? r.toFixed(0) : r.toFixed(1)}`;
const since = (b: Breakout) => (b.sinceFound ? `since found ${ago(b.thenTs)}` : ago(b.thenTs));

export default async function BreakoutsPage({ searchParams }: { searchParams: Promise<{ days?: string; min?: string; x?: string }> }) {
  const sp = await searchParams;
  const days = WINDOWS.includes(Number(sp.days)) ? Number(sp.days) : 3;
  const min = SIZES.includes(Number(sp.min)) ? Number(sp.min) : 500;
  const x = MULTIPLES.includes(Number(sp.x)) ? Number(sp.x) : 3;
  const [games, view] = await Promise.all([getBreakouts(days, min, x), currentView()]);
  const icons = await iconsFor(games.map((g) => Number(g.universe_id)));
  const href = (o: { days?: number; min?: number; x?: number }) => `/breakouts?days=${o.days ?? days}&min=${o.min ?? min}&x=${o.x ?? x}`;
  const pill = (on: boolean) => `rounded-full px-3 py-1 text-xs transition-colors ${on ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"}`;
  const group = "flex flex-wrap items-center gap-1.5";
  const label = "mr-1 text-xs text-muted-foreground";

  return (
    <div className="mx-auto grid max-w-[100rem] gap-5">
      <PageHeader title="Breakouts" subtitle="Games that went from small to notable in the last few days, measured against the same time of day.">
        <ViewToggle view={view} />
      </PageHeader>

      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <div className={group}>
          <span className={label}>In the last</span>
          {WINDOWS.map((d) => (
            <Link key={d} href={href({ days: d })} className={pill(d === days)}>
              {d === 1 ? "24 hours" : `${d} days`}
            </Link>
          ))}
        </div>
        <div className={group}>
          <span className={label}>Now at least</span>
          {SIZES.map((s) => (
            <Link key={s} href={href({ min: s })} className={pill(s === min)}>
              {num(s)} players
            </Link>
          ))}
        </div>
        <div className={group}>
          <span className={label}>Grew</span>
          {MULTIPLES.map((m) => (
            <Link key={m} href={href({ x: m })} className={pill(m === x)}>
              {m}× or more
            </Link>
          ))}
        </div>
      </div>

      {games.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No game fits yet. Try a shorter window or a smaller size; windows longer than the tracker has been running stay empty until enough history exists.
        </p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4 gap-y-6">
          {games.map((g) => (
            <Link key={g.universe_id} href={`/games/${g.universe_id}`} className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <GameIcon url={icons.get(Number(g.universe_id))} className="aspect-square w-full rounded-xl transition group-hover:brightness-110" />
              <div className="mt-2 truncate text-sm font-medium">{g.name}</div>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground tabular-nums">
                  {num(g.then)} → <span className="text-foreground">{num(g.playing)}</span>
                </span>
                <span className="shrink-0 font-medium text-emerald-400 tabular-nums">{times(g.ratio)}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{since(g)}</div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div role="table" className="min-w-[44rem] text-sm">
            <div role="row" className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_4.5rem_9rem_5rem_2rem] items-center gap-x-4 px-2 pb-2 text-xs text-muted-foreground">
              <span role="columnheader">Game</span>
              <span role="columnheader" className="text-right">
                Then
              </span>
              <span role="columnheader" className="text-right">
                Now
              </span>
              <span role="columnheader" className="text-right">
                Grew
              </span>
              <span role="columnheader">Measured from</span>
              <span role="columnheader" className="text-right">
                Age
              </span>
              <span />
            </div>
            {games.map((g) => (
              <div key={g.universe_id} role="row" className="relative grid grid-cols-[minmax(0,1fr)_6rem_6rem_4.5rem_9rem_5rem_2rem] items-center gap-x-4 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                <span className="flex min-w-0 items-center gap-3">
                  <GameIcon url={icons.get(Number(g.universe_id))} size={36} />
                  <span className="min-w-0">
                    <Link href={`/games/${g.universe_id}`} className="block truncate font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">
                      {g.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">{g.genre_l2 || g.genre_l1 || "–"}</span>
                  </span>
                </span>
                <span className="text-right text-muted-foreground tabular-nums">{num(g.then)}</span>
                <span className="text-right tabular-nums">{num(g.playing)}</span>
                <span className="text-right font-medium text-emerald-400 tabular-nums">{times(g.ratio)}</span>
                <span className="truncate text-xs text-muted-foreground">{since(g)}</span>
                <span className="text-right text-muted-foreground tabular-nums">{age(g.created_at)}</span>
                <span className="relative z-10">
                  <WatchToggle id={Number(g.universe_id)} watched={!!g.watched} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
