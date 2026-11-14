import Link from "next/link";
import { Plus } from "lucide-react";
import { addGameAction } from "@/app/actions";
import { FilterBar } from "@/components/filter-bar";
import { GamePicker } from "@/components/game-picker";
import { currentView, Games } from "@/components/game-table";
import { PageHeader, Presets } from "@/components/page-parts";
import { ViewToggle } from "@/components/quick-actions";
import { pollGames } from "@/lib/collector";
import { now, q } from "@/lib/db";
import { getGenres, listGames, parseFilters, SORT_LABELS } from "@/lib/queries";

const PAGE_SIZE = 60;

/** The Explore and Watchlist pages are the same screen with a different starting filter. */
export async function Explore({ sp, watch }: { sp: Record<string, string | string[] | undefined>; watch: boolean }) {
  const path = watch ? "/watchlist" : "/games";
  const defaultMin = watch ? 0 : 50;
  const f = parseFilters(sp);
  f.watch = watch;
  f.pageSize = PAGE_SIZE;
  if (f.min == null) f.min = defaultMin;
  if (watch) {
    // The watchlist is kept live: refresh any watched game whose numbers are over two minutes old (giving up after 6s).
    const stale = await q<{ universe_id: number }>("SELECT g.universe_id FROM games g JOIN watchlist w ON w.universe_id = g.universe_id WHERE COALESCE(g.last_polled, 0) < ? LIMIT 50", [now() - 120]);
    if (stale.length) await Promise.race([pollGames(stale.map((s) => Number(s.universe_id))).catch(() => 0), new Promise((r) => setTimeout(r, 6000))]);
  }
  const [{ games, total }, genres, view] = await Promise.all([listGames(f), getGenres(), currentView()]);
  const page = Math.max(f.page ?? 1, 1);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const strings = Object.entries(sp).filter(([k, v]) => typeof v === "string" && k !== "error") as [string, string][];
  const link = (p: number) => {
    const next = new URLSearchParams(strings);
    next.set("page", String(p));
    return `${path}?${next.toString()}`;
  };
  const current = new URLSearchParams(strings.filter(([k]) => k !== "page"));
  current.sort();
  const error = typeof sp.error === "string" ? sp.error : null;
  const pageBtn = "rounded-lg bg-muted/60 px-3 py-1.5 text-sm hover:bg-muted";

  return (
    <div className="mx-auto grid max-w-[100rem] gap-5">
      <PageHeader title={watch ? "Watchlist" : "Explore"} subtitle={`${total.toLocaleString("en-US")} ${total === 1 ? "game" : "games"}`}>
        <div className="flex items-center gap-2">
          {!watch && (
            <form action={addGameAction} className="flex items-center">
              <GamePicker placeholder="Add a game: type its name" className="w-60" />
              <button
                type="submit"
                aria-label="Add game"
                className="ml-1 inline-flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-4" />
              </button>
            </form>
          )}
          <ViewToggle view={view} />
        </div>
      </PageHeader>
      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      {!watch && <Presets current={current.toString()} />}
      <FilterBar genres={genres.map((g) => g.genre)} sorts={SORT_LABELS} defaultMin={defaultMin} />

      <div className="pt-2">
        {watch && total === 0 && !f.q ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nothing here yet. Hover a game and click the eye to watch it; watched games refresh every 15 minutes and raise alerts when they surge.
          </p>
        ) : (
          <Games games={games} view={view} />
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2 text-sm text-muted-foreground">
          {page > 1 ? (
            <Link href={link(page - 1)} className={pageBtn}>
              Previous
            </Link>
          ) : null}
          <span className="tabular-nums">
            {page} / {pages.toLocaleString("en-US")}
          </span>
          {page < pages ? (
            <Link href={link(page + 1)} className={pageBtn}>
              Next
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
