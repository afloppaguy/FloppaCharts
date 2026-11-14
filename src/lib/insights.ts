import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getApiKey, getClient, HAIKU, pickModel, recordUsage } from "./ai";
import { nowMs } from "./clock";
import { kvGet, kvSet, now, q, run } from "./db";
import { likePct } from "./format";
import { getNiches, getRisingNiches } from "./niches";
import { baseline, listGames, type Game } from "./queries";
import { scoped, uidNow } from "./scope";
import { tagGames, untaggedRising } from "./tagging";

// AI features that run on the tracked data without anyone asking a question:
// the daily briefing, the gap finder, and automatic tagging of rising games.

const today = () => new Date(nowMs()).toISOString().slice(0, 10);

function line(g: Game) {
  const b = baseline(g);
  const like = likePct(g.up_votes, g.down_votes);
  const ageDays = g.created_at ? Math.round((now() - g.created_at) / 86400) : null;
  return {
    id: Number(g.universe_id),
    name: g.name,
    genre: g.genre_l2 || g.genre_l1,
    players: g.playing,
    growth: b ? { from: b.value, window: b.label } : null,
    pace: g.pace,
    session_min: g.est_session_min,
    like_pct: like,
    age_days: ageDays,
  };
}

/**
 * Is this game's move worth mentioning? Every game swings with the time of
 * day, and the biggest ones swing by tens of thousands of players, so a
 * change only counts when it is measured against the same time yesterday, or
 * is far larger than a daily cycle in a game that is not already huge.
 */
function notable(g: Game, minPct24h = 15): boolean {
  const b = baseline(g);
  if (!b || b.value < 10) return false;
  const pct = ((g.playing - b.value) / b.value) * 100;
  if (b.label === "24h") return Math.abs(pct) >= minPct24h;
  return g.playing < 100_000 && Math.abs(pct) >= 40;
}

// ---- Daily briefing ----

const BRIEFING = `You write the daily briefing for one Roblox developer who uses a private dashboard that tracks thousands of games. They read it in under a minute to decide what to look at today.

You get today's data as JSON: the fastest risers, new games gaining players, games running above their usual pace, games losing players, hot niches, and the developer's watchlist.

Write the briefing in markdown, about 150 to 220 words:
- Start with one sentence: the single most notable thing in today's data.
- Then three or four short sections with a bold label each (for example **Rising**, **New**, **Niches**, **Watchlist**). Each is one to three sentences naming specific games with their numbers. Leave a section out if its data is empty.
- After a section that names games, add a line on its own in exactly this form: ::games 123, 456, 789 using those games' ids (up to 6). The dashboard turns it into a row of game cards.
- End with one line starting "Worth a look:" naming one game or niche to open first, and why.

What to leave out: anything the developer would already expect. Every game gains and loses players with the time of day, and the largest games move by tens of thousands of players within hours; that is the daily cycle, not news, so never report it. The same goes for the biggest games simply being big. A section with nothing unusual in it is omitted, and a short briefing is better than a padded one. If almost nothing stands out today, say so in one line.

Rules: use only the numbers given. Growth windows may be short ("1h", "since tracked"); say which window a figure covers and do not call a one-hour change a trend. Pace is a game's visit rate against its lifetime average. Plain words, no headings larger than bold labels, no advice on how to build games, no filler.`;

export async function generateBriefing(): Promise<string> {
  const [rising, fresh, pace, falling, niches, watch] = await Promise.all([
    listGames({ min: 100, sort: "rise", pageSize: 40 }),
    listGames({ min: 50, maxAge: 30, sort: "rise", pageSize: 30 }),
    listGames({ min: 200, maxAge: 180, sort: "pace", pageSize: 8 }),
    listGames({ min: 300, sort: "fall", pageSize: 40 }),
    getRisingNiches(8),
    listGames({ watch: true, min: 0, sort: "rise", pageSize: 12 }),
  ]);
  const data = {
    date: today(),
    // Only moves that are not just the daily cycle (see notable()).
    fastest_risers: rising.games.filter((g) => notable(g)).slice(0, 10).map(line),
    new_and_gaining: fresh.games.filter((g) => notable(g)).slice(0, 8).map(line),
    above_usual_pace: pace.games.filter((g) => g.playing < 150_000).map(line),
    losing_players: falling.games.filter((g) => notable(g, 20) && g.playing < (baseline(g)?.value ?? 0)).slice(0, 6).map(line),
    hot_niches: niches.map((n) => ({ niche: n.term, kind: n.kind, games: n.games, hot_games: n.hot, new_games: n.fresh, players: n.players, examples: n.top.map((t) => ({ id: t.universe_id, name: t.name })) })),
    watchlist: watch.games.map(line),
  };
  const client = await getClient();
  const res = await client.messages.create({
    model: HAIKU,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: BRIEFING,
    messages: [{ role: "user", content: JSON.stringify(data) }],
  });
  await recordUsage("briefing", HAIKU, res.usage);
  const body = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
  if (!body) throw new Error("The briefing came back empty.");
  await run("INSERT INTO briefings (day, body, model, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET body = excluded.body, model = excluded.model, created_at = excluded.created_at", [today(), body, HAIKU, now()]);
  return body;
}

export async function getBriefing() {
  const r = await q<{ day: string; body: string; created_at: number }>("SELECT day, body, created_at FROM briefings ORDER BY day DESC LIMIT 1");
  return r[0] ? { ...r[0], isToday: r[0].day === today() } : null;
}

// ---- Gap finder ----

const Gaps = z.object({
  gaps: z.array(
    z.object({
      niche: z.string().describe("The niche the gap is in, as named in the data"),
      signal: z.string().describe("Why this is a gap, with the numbers that show it (2 sentences at most)"),
      concept_name: z.string().describe("A Roblox-style game title for the concept, 2-5 words"),
      pitch: z.string().describe("The concept in one sentence: what the player does and why it is fun"),
      why_it_fits: z.string().describe("Why this concept suits the gap and a small team (1-2 sentences)"),
      risk: z.string().describe("The main reason it could fail (1 sentence)"),
      reference_ids: z.array(z.number()).describe("Universe ids of 2-5 games from the data that show the demand or the weak competition"),
    }),
  ),
});
export type Gap = z.infer<typeof Gaps>["gaps"][number];

const GAP_FINDER = `You look for openings in the Roblox market for one developer (solo or a small team), using a dashboard's data on thousands of tracked games.

You get niches as JSON, each with: how many tracked games it has, how many are hot (growing or on Roblox's trending charts), how many are new, total players, typical growth, the like ratio and age of its biggest games, and example games with ids.

A gap is a niche where players are clearly showing up but the supply is thin or weak. Signs of one: strong or growing player numbers with few games; the leaders are old or poorly rated; one game holds nearly all the players and has no real alternative; several new games gaining at once in a niche with no established leader. A niche that is simply big and crowded is not a gap, and neither is a niche with no players.

Return 4 to 6 gaps, best first. For each, propose one concrete game concept that a small team could ship, with a title and a one-sentence pitch. Be specific about the twist; "X but better" is not a concept.

Rules: every signal must quote numbers from the data. Use only ids that appear in the data. You have not played these games and know them only by title, genre and numbers, so do not describe their gameplay beyond what a title makes obvious. Do not oversell: these are leads to investigate, not sure hits, and the risk line must be a real one.`;

export async function findGaps(): Promise<{ gaps: number; cost: number }> {
  const [niches, leaders] = await Promise.all([
    getNiches(),
    q<{ universe_id: number; name: string; playing: number; up_votes: number; down_votes: number; created_at: number | null; sub: string | null; pace: number | null }>(
      "SELECT universe_id, name, playing, up_votes, down_votes, created_at, COALESCE(NULLIF(genre_l2, ''), genre_l1) AS sub, pace FROM games WHERE playing >= 20 AND last_polled IS NOT NULL",
    ),
  ]);
  const byId = new Map(leaders.map((g) => [Number(g.universe_id), g]));
  const t = now();
  const pick = [...niches.filter((n) => n.kind === "genre").slice(0, 45), ...niches.filter((n) => n.kind === "tag").slice(0, 25), ...niches.filter((n) => n.kind === "keyword" && n.games >= 4).slice(0, 45)];
  const data = pick.map((n) => ({
    niche: n.term,
    kind: n.kind,
    games: n.games,
    hot_games: n.hot,
    new_games_30d: n.fresh,
    declining_games: n.declining,
    players: n.players,
    typical_growth_pct: n.medianGrowth,
    one_game_dominates: n.oneHit,
    biggest_games: n.top.map((g) => {
      const full = byId.get(g.universe_id);
      return { id: g.universe_id, name: g.name, players: g.playing, like_pct: full ? likePct(full.up_votes, full.down_votes) : null, age_days: full?.created_at ? Math.round((t - full.created_at) / 86400) : null, pace: full?.pace ?? null };
    }),
  }));

  const client = await getClient();
  const model = await pickModel();
  const res = await client.messages.parse({
    model,
    max_tokens: 8000,
    system: GAP_FINDER,
    messages: [{ role: "user", content: JSON.stringify({ niches: data }) }],
    output_config: { format: zodOutputFormat(Gaps), effort: "medium" },
  });
  const cost = await recordUsage("gap finder", model, res.usage);
  if (!res.parsed_output?.gaps.length) throw new Error("Claude did not return any gaps. Try again.");
  const gaps = res.parsed_output.gaps.map((g) => ({ ...g, reference_ids: g.reference_ids.filter((id) => byId.has(id)).slice(0, 5) }));
  await run("INSERT INTO gap_runs (run_ts, model, data) VALUES (?, ?, ?)", [now(), model, JSON.stringify(gaps)]);
  return { gaps: gaps.length, cost };
}

export async function getGaps() {
  const r = await q<{ run_ts: number; model: string | null; data: string }>("SELECT run_ts, model, data FROM gap_runs ORDER BY id DESC LIMIT 1");
  return r[0] ? { run_ts: Number(r[0].run_ts), model: r[0].model, gaps: JSON.parse(r[0].data) as Gap[] } : null;
}

// ---- Background upkeep ----

export async function getAutoTag(): Promise<boolean> {
  return (await kvGet(scoped("auto_tag", await uidNow()))) !== "off";
}

/**
 * Small AI chores, run in the background after a page is served: write today's
 * briefing if there is none, and tag newly rising games every six hours.
 * Does nothing without a Claude key, and never runs twice at once.
 */
export async function dailyUpkeep() {
  try {
    if (!(await getApiKey())) return;
    const lock = Number((await kvGet("upkeep_lock")) ?? "0");
    if (now() - lock < 600) return;
    const [briefing, lastTag, autoTag] = await Promise.all([getBriefing(), kvGet("last_auto_tag"), getAutoTag()]);
    const needBriefing = !briefing?.isToday;
    const needTags = autoTag && now() - Number(lastTag ?? "0") > 6 * 3600;
    if (!needBriefing && !needTags) return;
    await kvSet("upkeep_lock", String(now()));
    if (needTags) {
      await kvSet("last_auto_tag", String(now()));
      const ids = await untaggedRising(40);
      if (ids.length) await tagGames(ids, "ai");
    }
    if (needBriefing) await generateBriefing();
  } catch (e) {
    console.error("upkeep failed:", e instanceof Error ? e.message : e);
  }
}
