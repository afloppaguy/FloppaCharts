import { now, q } from "./db";

// A niche is a group of similar games. Three ways of grouping, from most to
// least reliable:
//   genre   Roblox's own sub-genre (e.g. "Physics Sim", "Tower Defense")
//   tag     theme / mechanic tags added by AI tagging or by hand
//   keyword words and phrases shared by game titles
// Groups are ranked by BREADTH: how many separate games in the group are hot,
// never by one game's raw player gain. A group lifted by a single hit is
// labelled as such and ranked low.

export type NicheKind = "genre" | "tag" | "keyword";

export type Niche = {
  kind: NicheKind;
  term: string;
  games: number;
  players: number;
  hot: number; // games that are growing or on Roblox's trending / up-and-coming charts
  fresh: number; // games under 30 days old
  declining: number;
  medianGrowth: number | null; // percent, over games with a usable baseline
  oneHit: boolean; // most of the group's gain comes from a single game
  score: number;
  top: { universe_id: number; name: string; playing: number; hot: boolean }[];
};

type Row = {
  universe_id: number;
  name: string;
  playing: number;
  created_at: number | null;
  p_24h: number | null;
  p_1h: number | null;
  p_first: number | null;
  first_seen: number;
  genre_l1: string | null;
  genre_l2: string | null;
  charts: string;
};

// Words that say nothing about what a game is.
const STOP = new Set(
  `the a an of and or to in on at my for with your you our new update upd updated beta alpha game games roblox free vs is it be by from this that
   release released early access official remastered remake classic edition version test testing demo open world best fun big mega super ultra hyper
   event season part chapter story mode modes map maps codes code soon out now all get more one two three day days night real realistic experience
   friends friend wild guess original legacy reborn revamp fixed fix bug bugs sale off double triple boost luck lucky bonus gift gifts play join
   weekend halloween christmas easter summer winter spring fall rework huge giant tiny little mini max pro plus hub lobby server servers private
   dont but cant wont not can will how what who why are has have had into over under down per any every just like let lets got make made
   voice chat only online multiplayer roleplay simulator tycoon obby incremental infinite ultimate extreme insane crazy epic cool awesome`.split(/\s+/),
);

export function terms(name: string): string[] {
  const clean = name
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    .replace(/[^a-z\s']/g, " ")
    .replace(/'/g, "");
  const words = clean.split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
  const out = new Set<string>(words);
  for (let i = 0; i < words.length - 1; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return [...out];
}

const TREND_CHARTS = ["up-and-coming", "top-trending"];

function measure(g: Row, t: number) {
  const base = g.p_24h ?? g.p_1h ?? (t - g.first_seen > 1800 ? g.p_first : null);
  const diff = base != null ? g.playing - base : 0;
  const pct = base != null && base >= 10 ? (diff / base) * 100 : null;
  const growing = base != null && diff >= 10 && g.playing >= base * 1.15;
  const declining = base != null && diff <= -10 && g.playing <= base * 0.85;
  const charted = TREND_CHARTS.some((c) => g.charts.includes(`"${c}"`));
  return { diff, pct, growing, declining, hot: growing || charted };
}

function summarize(kind: NicheKind, term: string, gs: Row[], t: number): Niche {
  let players = 0;
  let hot = 0;
  let fresh = 0;
  let declining = 0;
  let gain = 0;
  let topGain = 0;
  const pcts: number[] = [];
  const hotIds = new Set<number>();
  for (const g of gs) {
    const m = measure(g, t);
    players += g.playing;
    if (m.hot) {
      hot++;
      hotIds.add(Number(g.universe_id));
    }
    if (m.declining) declining++;
    if (g.created_at && t - g.created_at < 30 * 86400) fresh++;
    if (m.pct != null) pcts.push(m.pct);
    if (m.diff > 0) {
      gain += m.diff;
      topGain = Math.max(topGain, m.diff);
    }
  }
  pcts.sort((a, b) => a - b);
  const medianGrowth = pcts.length >= 3 ? Math.round(pcts[Math.floor(pcts.length / 2)]) : null;
  const oneHit = hot <= 1 && gain > 0 && topGain / gain > 0.7;
  // Breadth first: several hot games in a small group beats one hot game in a
  // huge group. New entrants add a little; declines subtract a little.
  const share = hot / gs.length;
  const score = Math.round((hot * (0.5 + share) + fresh * 0.3 - declining * 0.3) * (oneHit ? 0.3 : 1) * 10) / 10;
  return {
    kind,
    term,
    games: gs.length,
    players,
    hot,
    fresh,
    declining,
    medianGrowth,
    oneHit,
    score,
    top: gs.slice(0, 4).map((g) => ({ universe_id: Number(g.universe_id), name: g.name, playing: g.playing, hot: hotIds.has(Number(g.universe_id)) })),
  };
}

let cache: { at: number; niches: Niche[] } | null = null;
export const clearNicheCache = () => {
  cache = null;
};

export async function getNiches(kind?: NicheKind): Promise<Niche[]> {
  if (!cache || Date.now() - cache.at > 5 * 60_000) cache = { at: Date.now(), niches: await build() };
  return kind ? cache.niches.filter((n) => n.kind === kind) : cache.niches;
}

/** The handful of niches worth showing on the home page, across all kinds. */
export async function getRisingNiches(limit = 9): Promise<Niche[]> {
  const all = await getNiches();
  return all
    .filter((n) => n.hot >= 2 && !n.oneHit)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function build(): Promise<Niche[]> {
  const t = now();
  const rows = await q<Row>(
    `SELECT universe_id, name, playing, created_at, p_24h, p_1h, p_first, first_seen, genre_l1, genre_l2, charts
     FROM games WHERE playing >= 20 AND last_polled IS NOT NULL ORDER BY playing DESC LIMIT 8000`,
  );
  const byId = new Map(rows.map((r) => [Number(r.universe_id), r]));
  const out: Niche[] = [];

  // 1. Roblox sub-genres
  const genres = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.genre_l2 || r.genre_l1;
    if (key) (genres.get(key) ?? genres.set(key, []).get(key)!).push(r);
  }
  for (const [term, gs] of genres) if (gs.length >= 3) out.push(summarize("genre", term, gs, t));

  // 2. Tags
  const tagRows = await q<{ universe_id: number; tag: string }>("SELECT universe_id, tag FROM tags");
  const tags = new Map<string, Row[]>();
  for (const tr of tagRows) {
    const g = byId.get(Number(tr.universe_id));
    if (g) (tags.get(tr.tag) ?? tags.set(tr.tag, []).get(tr.tag)!).push(g);
  }
  for (const [term, gs] of tags) if (gs.length >= 2) out.push(summarize("tag", term, gs.sort((a, b) => b.playing - a.playing), t));

  // 3. Title keywords
  const words = new Map<string, Row[]>();
  for (const r of rows) for (const term of terms(r.name)) (words.get(term) ?? words.set(term, []).get(term)!).push(r);
  const candidates = [...words.entries()].filter(([, gs]) => gs.length >= 4).sort((a, b) => b[0].length - a[0].length);
  // Drop a term when a longer phrase already kept covers nearly the same games
  // ("ragdoll" vs "realistic ragdoll" are different sizes and both stay;
  // "murder" vs "murder mystery" are the same games and only the phrase stays).
  const kept: [string, Set<number>][] = [];
  for (const [term, gs] of candidates) {
    const ids = new Set(gs.map((g) => Number(g.universe_id)));
    const dup = kept.some(([other, otherIds]) => {
      if (!other.includes(term) && !term.includes(other)) return false;
      let shared = 0;
      for (const id of ids) if (otherIds.has(id)) shared++;
      return shared / Math.max(ids.size, otherIds.size) >= 0.7;
    });
    if (dup) continue;
    kept.push([term, ids]);
    out.push(summarize("keyword", term, gs, t));
  }

  return out.sort((a, b) => b.score - a.score || b.players - a.players);
}

export function nicheHref(n: Pick<Niche, "kind" | "term">) {
  const key = n.kind === "genre" ? "sub" : n.kind === "tag" ? "tag" : "q";
  return `/games?${key}=${encodeURIComponent(n.term)}&min=20&sort=rise`;
}
