import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { currentView, Games } from "@/components/game-table";
import { NicheChart } from "@/components/niche-chart";
import { Section } from "@/components/page-parts";
import { ViewToggle } from "@/components/quick-actions";
import { now } from "@/lib/db";
import { num } from "@/lib/format";
import { getNicheHistory, getNicheTrends } from "@/lib/niche-history";
import { getNiche, keywordStats, nicheHref, type NicheKind } from "@/lib/niches";
import { listGames } from "@/lib/queries";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<NicheKind, string> = { genre: "Sub-genre", tag: "Theme or mechanic", keyword: "Title word" };

function Fact({ value, label, tone }: { value: string; label: string; tone?: "up" | "down" }) {
  return (
    <div>
      <div className={`text-xl font-semibold tracking-tight tabular-nums ${tone === "up" ? "text-emerald-400" : tone === "down" ? "text-rose-400" : ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const signed = (p: number | null) => (p == null ? "–" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`);
const tone = (p: number | null) => (p == null || p === 0 ? undefined : p > 0 ? "up" : "down");

export default async function NichePage({ params }: { params: Promise<{ kind: string; term: string }> }) {
  const p = await params;
  const kind = p.kind as NicheKind;
  if (!(kind in KIND_LABEL)) notFound();
  const term = decodeURIComponent(p.term);
  const niche = (await getNiche(kind, term)) ?? (kind === "keyword" ? ((await keywordStats(term))[0] ?? null) : null);
  if (!niche || niche.games === 0) notFound();

  const view = await currentView();
  const filter = kind === "genre" ? { sub: term } : kind === "tag" ? { tag: term } : { q: term };
  const [history, trends, games] = await Promise.all([getNicheHistory(kind, term), getNicheTrends(kind), listGames({ ...filter, min: 20, sort: "rise", pageSize: view === "grid" ? 28 : 20 })]);
  const trend = trends.get(term) ?? { day: null, week: null };

  return (
    <div className="mx-auto grid max-w-[100rem] gap-10">
      <div className="grid gap-4">
        <Link href={`/niches?kind=${kind}`} className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Niches
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight capitalize">{niche.term}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {KIND_LABEL[kind]}
              {niche.oneHit ? " · most of its growth comes from a single game" : ""}
            </p>
          </div>
          <ViewToggle view={view} />
        </header>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <Fact value={num(niche.players)} label="players now" />
          <Fact value={signed(trend.day)} label="against this time yesterday" tone={tone(trend.day)} />
          <Fact value={signed(trend.week)} label="last 24h against a week ago" tone={tone(trend.week)} />
          <Fact value={String(niche.games)} label="games with 20+ players" />
          <Fact value={`${niche.hot}`} label="hot right now" tone={niche.hot >= 2 ? "up" : undefined} />
          <Fact value={String(niche.fresh)} label="new this month" />
        </div>
      </div>

      <Section title="Over time" hint="Is this group early, peaking or fading?">
        <NicheChart points={history} nowTs={now()} />
      </Section>

      <Section title="Games in this group" hint="Rising fastest first" href={nicheHref(niche)}>
        <Games games={games.games} view={view} />
      </Section>
    </div>
  );
}
