import Link from "next/link";
import { Search } from "lucide-react";
import { TagRisingButton } from "@/components/ai-buttons";
import { currentView, GameIcon } from "@/components/game-table";
import { PageHeader } from "@/components/page-parts";
import { ViewToggle } from "@/components/quick-actions";
import { num } from "@/lib/format";
import { getNicheTrends, type NicheTrend } from "@/lib/niche-history";
import { getNiches, keywordStats, nichePage, type Niche, type NicheKind } from "@/lib/niches";
import { iconsFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

const KINDS: { kind: NicheKind; label: string; blurb: string }[] = [
  { kind: "genre", label: "Sub-genres", blurb: "Roblox's own sub-genre for each game. The most reliable grouping." },
  { kind: "tag", label: "Themes and mechanics", blurb: "Tags added by AI tagging or by you. The sharpest grouping once enough games are tagged." },
  { kind: "keyword", label: "Title words", blurb: "Words and phrases shared by game titles. Crude, but catches trends before anything else does." },
];

const growthText = (g: number | null) => (g == null ? "–" : `${g > 0 ? "+" : g < 0 ? "−" : ""}${Math.abs(g)}%`);
const growthColor = (g: number | null) => (g == null ? "text-muted-foreground/60" : g > 0 ? "text-emerald-400" : g < 0 ? "text-rose-400" : "text-muted-foreground");

type Trends = Map<string, NicheTrend>;

function NicheList({ niches, trends }: { niches: Niche[]; trends: Trends }) {
  const cols = "grid-cols-[minmax(0,14rem)_4rem_6.5rem_4rem_5rem_5.5rem_5.5rem_5.5rem_minmax(0,1fr)]";
  const head = "text-right text-xs text-muted-foreground";
  return (
    <div role="table" className="min-w-[58rem] text-sm">
      <div role="row" className={`grid items-center gap-x-4 px-2 pb-2 ${cols}`}>
        <span role="columnheader" className="text-xs text-muted-foreground">
          Niche
        </span>
        <span role="columnheader" className={head}>
          Games
        </span>
        <span role="columnheader" className={head} title="Games growing 15%+ or on Roblox's Up-and-Coming or Top Trending charts">
          Hot games
        </span>
        <span role="columnheader" className={head} title="Games created in the last 30 days">
          New
        </span>
        <span role="columnheader" className={head}>
          Players
        </span>
        <span role="columnheader" className={head} title="Median player growth across the group's games">
          Typical growth
        </span>
        <span role="columnheader" className={head} title="The group's total players against the same hour yesterday">
          Vs yesterday
        </span>
        <span role="columnheader" className={head} title="The group's players over the last 24 hours against the same 24 hours a week ago">
          Vs last week
        </span>
        <span role="columnheader" className="text-xs text-muted-foreground">
          Biggest games
        </span>
      </div>
      {niches.map((n) => (
        <div key={n.term} role="row" className={`group relative grid items-center gap-x-4 rounded-lg px-2 py-2 hover:bg-muted/50 ${cols}`}>
          <span className="flex min-w-0 items-center gap-2">
            <Link href={nichePage(n)} className="truncate font-medium capitalize outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">
              {n.term}
            </Link>
            {n.oneHit && (
              <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300" title="Most of this group's growth comes from a single game">
                one hit
              </span>
            )}
          </span>
          <span className="text-right tabular-nums">{n.games}</span>
          <span className={`text-right tabular-nums ${n.hot >= 2 ? "text-emerald-400" : "text-muted-foreground"}`}>
            {n.hot}
            {n.games > 0 && <span className="text-xs text-muted-foreground"> · {Math.round((n.hot / n.games) * 100)}%</span>}
          </span>
          <span className="text-right tabular-nums text-muted-foreground">{n.fresh || "–"}</span>
          <span className="text-right tabular-nums">{num(n.players)}</span>
          <span className={`text-right tabular-nums ${growthColor(n.medianGrowth)}`}>{growthText(n.medianGrowth)}</span>
          <span className={`text-right tabular-nums ${growthColor(trends.get(n.term)?.day ?? null)}`}>{growthText(trends.get(n.term)?.day ?? null)}</span>
          <span className={`text-right tabular-nums ${growthColor(trends.get(n.term)?.week ?? null)}`}>{growthText(trends.get(n.term)?.week ?? null)}</span>
          <span className="relative z-10 truncate text-xs text-muted-foreground">
            {n.top.map((g, i) => (
              <span key={g.universe_id}>
                {i > 0 && ", "}
                <Link href={`/games/${g.universe_id}`} className={`hover:underline ${g.hot ? "text-foreground" : ""}`}>
                  {g.name}
                </Link>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

async function NicheGrid({ niches, trends }: { niches: Niche[]; trends: Trends }) {
  const icons = await iconsFor(niches.flatMap((n) => n.top.map((g) => g.universe_id)));
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
      {niches.map((n) => (
        <Link key={n.term} href={nichePage(n)} className="group rounded-2xl bg-muted/30 p-3 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: 4 }, (_, i) => (
              <GameIcon key={i} url={n.top[i] ? icons.get(n.top[i].universe_id) : undefined} className={`aspect-square w-full rounded-lg ${n.top[i] ? "" : "opacity-30"}`} />
            ))}
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium capitalize">{n.term}</span>
            {n.oneHit && <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">one hit</span>}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
            <span className={n.hot >= 2 ? "text-emerald-400" : "text-muted-foreground"}>
              {n.hot} of {n.games} hot
            </span>
            <span className={`tabular-nums ${growthColor(n.medianGrowth)}`}>{growthText(n.medianGrowth)}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {num(n.players)} players{n.fresh ? ` · ${n.fresh} new` : ""}
          </div>
          {trends.get(n.term)?.day != null && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              <span className={growthColor(trends.get(n.term)!.day)}>{growthText(trends.get(n.term)!.day)}</span> players vs yesterday
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}

export default async function NichesPage({ searchParams }: { searchParams: Promise<{ kind?: string; kw?: string }> }) {
  const sp = await searchParams;
  const kw = (sp.kw ?? "").trim();
  const active = KINDS.find((k) => k.kind === sp.kind) ?? KINDS[0];
  const [niches, view, trends] = await Promise.all([
    kw ? keywordStats(kw) : getNiches(active.kind).then((n) => n.slice(0, 120)),
    currentView(),
    getNicheTrends(kw ? "keyword" : active.kind).catch(() => new Map() as Trends),
  ]);
  const pill = "rounded-full px-3 py-1 text-xs transition-colors";

  return (
    <div className="mx-auto grid max-w-[100rem] gap-5">
      <PageHeader title="Niches" subtitle="Groups of similar games, ranked by how many separate games in the group are hot right now, not by one game's numbers.">
        <div className="flex items-center gap-2">
          {!kw && active.kind === "tag" && <TagRisingButton />}
          <ViewToggle view={view} />
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <form action="/niches" className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            name="kw"
            defaultValue={kw}
            aria-label="Look up keywords"
            placeholder="Look up keywords: smash, throw, steal, egg"
            className="h-8 w-80 rounded-lg bg-muted/60 pr-2.5 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>
        {kw ? (
          <Link href="/niches" className={`${pill} bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground`}>
            Back to all niches
          </Link>
        ) : (
          KINDS.map((k) => (
            <Link
              key={k.kind}
              href={`/niches?kind=${k.kind}`}
              className={`${pill} ${k.kind === active.kind ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {k.label}
            </Link>
          ))
        )}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {kw ? "Each word is matched against the start of words in game titles, among games with 20+ players. Separate several with commas." : active.blurb}
      </p>

      {niches.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {kw ? "Type at least two letters." : active.kind === "tag" ? "No tagged games yet. Tag rising games with AI, or add tags on a game's page." : "Not enough games collected yet."}
        </p>
      ) : view === "grid" ? (
        <NicheGrid niches={niches} trends={trends} />
      ) : (
        <div className="overflow-x-auto">
          <NicheList niches={niches} trends={trends} />
        </div>
      )}
    </div>
  );
}
