import Link from "next/link";
import { currentView, Games } from "@/components/game-table";
import { PageHeader, Presets, Section } from "@/components/page-parts";
import { ViewToggle } from "@/components/quick-actions";
import { now } from "@/lib/db";
import { num } from "@/lib/format";
import { getRisingNiches, nicheHref, type Niche } from "@/lib/niches";
import { getStatus, listGames } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const view = await currentView();
  const count = view === "grid" ? 14 : 8;
  const [status, fresh, growing, niches] = await Promise.all([
    getStatus(),
    listGames({ maxAge: 30, min: 50, sort: "rise", pageSize: count }),
    listGames({ min: 50, sort: "rise", pageSize: count }),
    getRisingNiches(9),
  ]);
  const historyHours = status.oldestSnapshot ? (now() - status.oldestSnapshot) / 3600 : 0;

  return (
    <div className="mx-auto grid max-w-6xl gap-10">
      <div className="grid gap-4">
        <PageHeader title="Home" subtitle={`${num(status.active)} active games out of ${num(status.games)} tracked`}>
          <ViewToggle view={view} />
        </PageHeader>
        <Presets />
      </div>

      {status.games === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No data yet. Start the collector with <code className="rounded bg-muted px-1.5 py-0.5">npm run collect</code> and refresh.
        </p>
      ) : (
        <>
          {historyHours < 24 && (
            <p className="text-xs text-muted-foreground">
              <span className="mr-1.5 inline-block size-1.5 rounded-full bg-amber-500 align-middle" />
              Tracking began {historyHours < 1 ? "under an hour" : `${Math.round(historyHours)} hours`} ago. Growth is measured from when each game was first
              tracked until a full day of history exists.
            </p>
          )}
          <div className={view === "grid" ? "grid gap-10" : "grid gap-10 xl:grid-cols-2"}>
            <Section title="New and gaining" hint="Under 30 days old" href="/games?maxAge=30&min=50&sort=rise">
              <Games games={fresh.games} view={view} compact />
            </Section>
            <Section title="Fastest growing" hint="Any age" href="/games?min=50&sort=rise">
              <Games games={growing.games} view={view} compact />
            </Section>
          </div>
          <Section title="Rising niches" hint="Groups where several games are hot at once" href="/niches">
            <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
              {niches.map((n: Niche) => (
                <Link key={`${n.kind}:${n.term}`} href={nicheHref(n)} className="-mx-2 rounded-lg px-2 py-2 hover:bg-muted/50">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium capitalize">{n.term}</span>
                    <span className="shrink-0 text-xs text-emerald-400 tabular-nums">
                      {n.hot} of {n.games} hot
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {num(n.players)} players{n.fresh ? ` · ${n.fresh} new this month` : ""}
                  </div>
                </Link>
              ))}
              {niches.length === 0 && <p className="text-sm text-muted-foreground">No group has two or more hot games yet.</p>}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
