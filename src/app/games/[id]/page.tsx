import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Play } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { TagGameButton } from "@/components/ai-buttons";
import { BackfillButton, Notes, Tags, WatchButton } from "@/components/game-actions";
import { getApiKey } from "@/lib/ai";
import { pollGames } from "@/lib/collector";
import { currentView, GameIcon, Games, Growth, Pace, sessionText } from "@/components/game-table";
import { similarGames } from "@/lib/related";
import { HistoryChart, type Point } from "@/components/history-chart";
import { Section } from "@/components/page-parts";
import { now } from "@/lib/db";
import { age, ago, likePct, num } from "@/lib/format";
import { getGame, getHistory, getNote, getTags, iconsFor } from "@/lib/queries";
import { getGamePasses, playUrl, webUrl, type GamePass } from "@/lib/roblox";

export const dynamic = "force-dynamic";

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function Delta({ label, playing, then }: { label: string; playing: number; then: number | null }) {
  if (then == null) return null;
  const d = playing - then;
  const pct = then >= 10 ? ` (${Math.round((Math.abs(d) / then) * 100)}%)` : "";
  return (
    <span>
      {label}{" "}
      <span className={`tabular-nums ${d > 0 ? "text-emerald-400" : d < 0 ? "text-rose-400" : ""}`}>
        {d >= 0 ? "+" : "−"}
        {num(Math.abs(d))}
        {pct}
      </span>
    </span>
  );
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  let g = await getGame(id);
  if (!g) notFound();
  // An open game page is kept live: if its numbers are more than two minutes
  // old, fetch fresh ones from Roblox before showing it (giving up after 5s).
  if (now() - Number(g.last_polled ?? 0) > 120) {
    const fresh = await Promise.race([pollGames([id]).then(() => getGame(id)), new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))]).catch(() => null);
    if (fresh) g = fresh;
  }

  const hasAi = !!(await getApiKey());
  const [history, note, tags, icons, passes, similar, view] = await Promise.all([
    getHistory(id),
    getNote(id),
    getTags(id),
    iconsFor([id]),
    getGamePasses(id).catch(() => [] as GamePass[]),
    similarGames(g, 14).catch(() => []),
    currentView(),
  ]);
  const points: Point[] = history.map((s) => ({
    ts: Number(s.ts),
    playing: s.playing,
    visits: s.visits,
    like: s.up_votes != null && s.down_votes != null && s.up_votes + s.down_votes > 0 ? Math.round((s.up_votes / (s.up_votes + s.down_votes)) * 1000) / 10 : null,
  }));
  const like = likePct(g.up_votes, g.down_votes);
  const charts = JSON.parse(g.charts || "[]") as string[];
  const forSale = passes.filter((p) => p.isForSale && p.price != null).sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const chip = "rounded-full bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground";

  return (
    <div className="mx-auto grid max-w-7xl gap-10">
      <header className="flex flex-wrap items-center gap-5">
        <GameIcon url={icons.get(id)} size={88} className="rounded-2xl" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight" title={g.name}>
            {g.name}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {g.creator_id ? (
              <Link href={`/creators/${g.creator_type === "Group" ? "group" : "user"}/${g.creator_id}`} className="text-foreground/90 underline-offset-4 hover:underline" title="See all of this creator's games">
                {g.creator_name ?? "Unknown creator"}
              </Link>
            ) : (
              (g.creator_name ?? "Unknown creator")
            )}{" "}
            · {age(g.created_at)} old · updated {ago(g.updated_at)}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {g.genre_l1 && (
              <Link href={`/games?genre=${encodeURIComponent(g.genre_l1)}`} className={`${chip} hover:text-foreground`}>
                {g.genre_l2 ? `${g.genre_l1} · ${g.genre_l2}` : g.genre_l1}
              </Link>
            )}
            {charts.map((c) => (
              <Link key={c} href={`/games?chart=${c}&min=0&sort=playing`} className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-xs text-sky-300 capitalize hover:bg-sky-500/20">
                {c.replace(/-/g, " ")}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/compare?ids=${id}`} className={buttonVariants({ variant: "outline" })}>
            Compare
          </Link>
          <WatchButton id={id} watched={!!g.watched} />
          {g.root_place_id && (
            <a href={webUrl(g.root_place_id)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "icon" })} title="Open on roblox.com" aria-label="Open on roblox.com">
              <ExternalLink />
            </a>
          )}
          {g.root_place_id && (
            <a href={playUrl(g.root_place_id)} className={buttonVariants()}>
              <Play fill="currentColor" /> Play
            </a>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Playing now" value={num(g.playing)} sub={<Growth g={g} />} />
        <Stat label="Peak seen" value={num(g.peak_playing)} />
        <Stat label="Visits" value={num(g.visits)} />
        <Stat label="Like ratio" value={like != null ? `${like}%` : "–"} sub={`${num(g.up_votes + g.down_votes)} votes`} />
        <Stat label="Favorites" value={num(g.favorites)} sub={g.visits > 0 ? `${((g.favorites / g.visits) * 1000).toFixed(1)} per 1K visits` : undefined} />
        <Stat label="Server size" value={g.max_players ?? "–"} />
        <Stat label="Visits per hour" value={g.visit_rate != null ? num(Math.round(g.visit_rate)) : "–"} sub="right now" />
        <Stat label="Pace vs lifetime" value={<Pace value={g.pace} />} sub="1.0 is its usual rate" />
        <Stat label="Est. session" value={sessionText(g.est_session_min)} sub="players ÷ visits per minute" />
        <Stat label="Lifetime visits a day" value={g.created_at ? num(Math.round(g.visits / Math.max((now() - g.created_at) / 86400, 1))) : "–"} />
      </div>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <h2 className="text-base font-semibold tracking-tight text-foreground">History</h2>
            <Delta label="1h" playing={g.playing} then={g.p_1h} />
            <Delta label="24h" playing={g.playing} then={g.p_24h} />
            <Delta label="7d" playing={g.playing} then={g.p_7d} />
          </div>
          <BackfillButton id={id} done={!!g.backfilled} />
        </div>
        <HistoryChart points={points} nowTs={now()} />
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Playtest notes" hint="Private; connected AI can read them">
          <Notes id={id} initial={note?.body ?? ""} />
          <div className="flex flex-wrap items-center gap-2">
            <Tags id={id} tags={tags} />
            {hasAi && <TagGameButton id={id} />}
          </div>
        </Section>

        <div className="grid content-start gap-10">
          <Section title="Game passes" hint={forSale.length ? `${forSale.length} on sale` : undefined}>
            {forSale.length ? (
              <ul className="grid max-h-56 gap-1.5 overflow-y-auto pr-2 text-sm">
                {forSale.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{num(p.price)} R$</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None on sale, or not public.</p>
            )}
          </Section>
          <Section title="Description">
            <p className="max-h-64 overflow-y-auto pr-2 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{g.description || "No description."}</p>
          </Section>
        </div>
      </div>

      {similar.length > 0 && (
        <Section title="Similar games" hint="Same sub-genre, shared title words or shared tags">
          <Games games={similar} view={view} compact />
        </Section>
      )}

      <p className="text-xs text-muted-foreground/70">
        Universe {g.universe_id} · found via {g.source} · checked {ago(g.last_polled)} · {history.length.toLocaleString("en-US")} history points
        {g.backfilled ? " (older ones from Rolimons)" : ""}
      </p>
    </div>
  );
}
