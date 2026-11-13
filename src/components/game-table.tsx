import Link from "next/link";
import { cookies } from "next/headers";
import { Play } from "lucide-react";
import { WatchToggle, type View } from "@/components/quick-actions";
import { age, growth, likePct, num } from "@/lib/format";
import { baseline, iconsFor, type Game } from "@/lib/queries";
import { playUrl } from "@/lib/roblox";
import { cn } from "@/lib/utils";

export async function currentView(): Promise<View> {
  return (await cookies()).get("radar_view")?.value === "list" ? "list" : "grid";
}

export function Growth({ g, className }: { g: Game; className?: string }) {
  const b = baseline(g);
  if (!b) return <span className={cn("text-muted-foreground/60", className)}>–</span>;
  const gr = growth(g.playing, b.value);
  const window = b.label === "24h" ? "in 24h" : b.label === "1h" ? "in the last hour" : "since tracking began";
  return (
    <span
      className={cn("tabular-nums", gr.flat ? "text-muted-foreground" : gr.up ? "text-emerald-400" : "text-rose-400", className)}
      title={`${num(b.value)} → ${num(g.playing)} players ${window}`}
    >
      {gr.text}
      {b.label === "1h" && <span className="ml-0.5 text-[10px] opacity-60">1h</span>}
    </span>
  );
}

export function GameIcon({ url, size, className }: { url?: string; size?: number; className?: string }) {
  const style = size ? { width: size, height: size } : undefined;
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={style} className={cn("shrink-0 rounded-lg bg-muted object-cover", className)} loading="lazy" />
  ) : (
    <div style={style} className={cn("shrink-0 rounded-lg bg-muted", className)} />
  );
}

function PlayLink({ placeId, className }: { placeId: number | null; className?: string }) {
  if (!placeId) return null;
  return (
    <a
      href={playUrl(placeId)}
      aria-label="Play in Roblox"
      title="Play in Roblox"
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Play className="size-3.5" fill="currentColor" />
    </a>
  );
}

const likeColor = (like: number | null) => (like == null ? "text-muted-foreground/60" : like >= 90 ? "text-emerald-400" : like < 60 ? "text-rose-400" : "");

function Empty() {
  return <p className="py-12 text-center text-sm text-muted-foreground">No games match these filters.</p>;
}

/** Dense rows: best for comparing numbers. */
async function GameList({ games, compact }: { games: Game[]; compact: boolean }) {
  const icons = await iconsFor(games.map((g) => Number(g.universe_id)));
  const cols = compact ? "grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_3.5rem_3.5rem]" : "grid-cols-[minmax(0,1fr)_5rem_5rem_4rem_4rem_5rem_9rem_3.75rem]";
  const head = "text-right text-xs font-normal text-muted-foreground";
  return (
    <div role="table" className="text-sm">
      <div role="row" className={cn("grid items-center gap-x-3 px-2 pb-2", cols)}>
        <span role="columnheader" className="text-xs text-muted-foreground">
          Game
        </span>
        <span role="columnheader" className={head}>
          Players
        </span>
        <span role="columnheader" className={head}>
          Growth
        </span>
        <span role="columnheader" className={head}>
          Likes
        </span>
        <span role="columnheader" className={head}>
          Age
        </span>
        {!compact && (
          <>
            <span role="columnheader" className={head}>
              Visits
            </span>
            <span role="columnheader" className="text-xs text-muted-foreground">
              Genre
            </span>
            <span />
          </>
        )}
      </div>
      {games.map((g) => {
        const like = likePct(g.up_votes, g.down_votes);
        const id = Number(g.universe_id);
        return (
          <div key={id} role="row" className={cn("group relative grid items-center gap-x-3 rounded-lg px-2 py-1.5 hover:bg-muted/50", cols)}>
            <Link href={`/games/${id}`} className="flex min-w-0 items-center gap-3 outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">
              <GameIcon url={icons.get(id)} size={compact ? 32 : 36} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{g.name || `Game ${id}`}</span>
                {!compact && <span className="block truncate text-xs text-muted-foreground">{g.creator_name ?? ""}</span>}
              </span>
            </Link>
            <span className="text-right tabular-nums">{num(g.playing)}</span>
            <Growth g={g} className="text-right" />
            <span className={cn("text-right tabular-nums", likeColor(like))}>{like != null ? `${like}%` : "–"}</span>
            <span className="text-right tabular-nums text-muted-foreground">{age(g.created_at)}</span>
            {!compact && (
              <>
                <span className="text-right tabular-nums text-muted-foreground">{num(g.visits)}</span>
                <span className="truncate text-xs text-muted-foreground">{g.genre_l2 || g.genre_l1 || ""}</span>
                <span className="relative z-10 flex justify-end">
                  <WatchToggle id={id} watched={!!g.watched} />
                  <PlayLink placeId={g.root_place_id} className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground" />
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Cards with large icons: best for browsing. */
async function GameGrid({ games, compact }: { games: Game[]; compact: boolean }) {
  const icons = await iconsFor(games.map((g) => Number(g.universe_id)));
  return (
    <div className={cn("grid gap-x-4 gap-y-6", compact ? "grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]")}>
      {games.map((g) => {
        const like = likePct(g.up_votes, g.down_votes);
        const id = Number(g.universe_id);
        return (
          <div key={id} className="group relative">
            <Link href={`/games/${id}`} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <GameIcon url={icons.get(id)} className="aspect-square w-full rounded-xl transition group-hover:brightness-110" />
              <div className="mt-2 truncate text-sm font-medium" title={g.name}>
                {g.name || `Game ${id}`}
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2 text-sm">
                <span className="tabular-nums">
                  {num(g.playing)} <span className="text-xs text-muted-foreground">playing</span>
                </span>
                <Growth g={g} className="text-xs" />
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("tabular-nums", likeColor(like))}>{like != null ? `${like}%` : "–"}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{age(g.created_at)}</span>
                {!compact && (g.genre_l2 || g.genre_l1) && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{g.genre_l2 || g.genre_l1}</span>
                  </>
                )}
              </div>
            </Link>
            <WatchToggle id={id} watched={!!g.watched} className="absolute top-1.5 right-1.5 bg-black/60 text-white backdrop-blur-sm hover:text-white" />
            <PlayLink
              placeId={g.root_place_id}
              className="absolute top-1.5 left-1.5 bg-white text-black opacity-0 shadow-sm group-hover:opacity-100"
            />
          </div>
        );
      })}
    </div>
  );
}

export async function Games({ games, view, compact = false }: { games: Game[]; view: View; compact?: boolean }) {
  if (!games.length) return <Empty />;
  return view === "grid" ? <GameGrid games={games} compact={compact} /> : <GameList games={games} compact={compact} />;
}
