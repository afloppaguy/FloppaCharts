import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { currentView, Games } from "@/components/game-table";
import { PageHeader, Section } from "@/components/page-parts";
import { ViewToggle } from "@/components/quick-actions";
import { now } from "@/lib/db";
import { age, likePct, num } from "@/lib/format";
import { creatorGames, scanCreator, type CreatorType } from "@/lib/related";

export const dynamic = "force-dynamic";

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export default async function CreatorPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const p = await params;
  const type: CreatorType | null = p.type === "group" ? "Group" : p.type === "user" ? "User" : null;
  const id = Number(p.id);
  if (!type || !Number.isFinite(id)) notFound();

  // Pull in the creator's other public games (at most once a day; never hold the page more than 6s).
  await Promise.race([scanCreator(type, id).catch(() => 0), new Promise((r) => setTimeout(r, 6000))]);
  const [games, view] = await Promise.all([creatorGames(type, id), currentView()]);
  if (!games.length) notFound();

  const name = games[0].creator_name ?? "Unknown creator";
  const live = games.filter((g) => g.playing >= 10);
  const hits = games.filter((g) => g.peak_playing >= 1000);
  const players = games.reduce((s, g) => s + g.playing, 0);
  const visits = games.reduce((s, g) => s + g.visits, 0);
  const votes = games.reduce((s, g) => ({ up: s.up + g.up_votes, down: s.down + g.down_votes }), { up: 0, down: 0 });
  const like = likePct(votes.up, votes.down);
  const newest = games.filter((g) => g.created_at).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  const recent = games.filter((g) => g.created_at && now() - g.created_at < 90 * 86400);
  const profile = type === "Group" ? `https://www.roblox.com/communities/${id}` : `https://www.roblox.com/users/${id}/profile`;

  return (
    <div className="mx-auto grid max-w-[100rem] gap-8">
      <PageHeader title={name} subtitle={`${type === "Group" ? "Group" : "Developer"} · ${games.length} tracked ${games.length === 1 ? "game" : "games"}`}>
        <div className="flex items-center gap-2">
          <a href={profile} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            Roblox profile <ExternalLink className="size-3.5" />
          </a>
          <ViewToggle view={view} />
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Players now" value={num(players)} sub="across all games" />
        <Stat label="Total visits" value={num(visits)} />
        <Stat label="Games with players" value={`${live.length} of ${games.length}`} sub="10+ online" />
        <Stat label="Hits" value={hits.length} sub="peaked at 1,000+ players" />
        <Stat label="Like ratio" value={like != null ? `${like}%` : "–"} sub="all games combined" />
        <Stat label="Newest game" value={newest ? `${age(newest.created_at)} ago` : "–"} sub={recent.length ? `${recent.length} released in 90 days` : undefined} />
      </div>

      <Section title="Games" hint="Most players first">
        <Games games={games} view={view} />
      </Section>
    </div>
  );
}
