import Link from "next/link";
import { PageHeader } from "@/components/page-parts";
import { TagRisingButton } from "@/components/ai-buttons";
import { num } from "@/lib/format";
import { getNiches, nicheHref, type NicheKind } from "@/lib/niches";

export const dynamic = "force-dynamic";

const KINDS: { kind: NicheKind; label: string; blurb: string }[] = [
  { kind: "genre", label: "Sub-genres", blurb: "Roblox's own sub-genre for each game. The most reliable grouping." },
  { kind: "tag", label: "Themes and mechanics", blurb: "Tags added by AI tagging or by you. The sharpest grouping once enough games are tagged." },
  { kind: "keyword", label: "Title words", blurb: "Words and phrases shared by game titles. Crude, but catches trends before anything else does." },
];

export default async function NichesPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const active = KINDS.find((k) => k.kind === sp.kind) ?? KINDS[0];
  const niches = (await getNiches(active.kind)).slice(0, 120);
  const cols = "grid-cols-[minmax(0,14rem)_4rem_6.5rem_4rem_5rem_5.5rem_minmax(0,1fr)]";
  const head = "text-right text-xs text-muted-foreground";

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <PageHeader
        title="Niches"
        subtitle="Groups of similar games, ranked by how many separate games in the group are hot right now, not by one game's numbers."
      >
        {active.kind === "tag" && <TagRisingButton />}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-1.5">
        {KINDS.map((k) => (
          <Link
            key={k.kind}
            href={`/niches?kind=${k.kind}`}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${k.kind === active.kind ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {k.label}
          </Link>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">{active.blurb}</span>
      </div>

      <div role="table" className="text-sm">
        <div role="row" className={`grid items-center gap-x-4 px-2 pb-2 ${cols}`}>
          <span role="columnheader" className="text-xs text-muted-foreground">
            Niche
          </span>
          <span role="columnheader" className={head}>
            Games
          </span>
          <span role="columnheader" className={head} title="Games growing 15%+ or on Roblox's trending and up-and-coming charts">
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
          <span role="columnheader" className="text-xs text-muted-foreground">
            Biggest games
          </span>
        </div>
        {niches.map((n) => (
          <div key={n.term} role="row" className={`group relative grid items-center gap-x-4 rounded-lg px-2 py-2 hover:bg-muted/50 ${cols}`}>
            <span className="flex min-w-0 items-center gap-2">
              <Link href={nicheHref(n)} className="truncate font-medium capitalize outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring">
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
              <span className="text-xs text-muted-foreground"> · {Math.round((n.hot / n.games) * 100)}%</span>
            </span>
            <span className="text-right tabular-nums text-muted-foreground">{n.fresh || "–"}</span>
            <span className="text-right tabular-nums">{num(n.players)}</span>
            <span
              className={`text-right tabular-nums ${n.medianGrowth == null ? "text-muted-foreground/60" : n.medianGrowth > 0 ? "text-emerald-400" : n.medianGrowth < 0 ? "text-rose-400" : "text-muted-foreground"}`}
            >
              {n.medianGrowth == null ? "–" : `${n.medianGrowth > 0 ? "+" : n.medianGrowth < 0 ? "−" : ""}${Math.abs(n.medianGrowth)}%`}
            </span>
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
        {niches.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {active.kind === "tag" ? "No tagged games yet. Tag rising games with AI, or add tags on a game's page." : "Not enough games collected yet."}
          </p>
        )}
      </div>
    </div>
  );
}
