import { randomUUID } from "node:crypto";
import { db, now, q, ready } from "./db";
import { pollGames } from "./collector";
import { getNiches } from "./niches";
import * as ops from "./ops";
import { baseline, getAlerts, getGame, getHistory, getNote, getPresets, getStatus, getTags, listGames, type Filters, type Game } from "./queries";
import { getGamePasses, searchGames } from "./roblox";
import { assertSafeQuery } from "./security";

// Tools exposed to AI assistants over MCP. Reads cover the whole dataset with
// paging; writes go through ops.ts so they are logged and undoable.

type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tool = { name: string; description: string; inputSchema: Schema; run: (a: Record<string, any>) => Promise<unknown> };

const day = (ts: number | null) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null);

function brief(g: Game) {
  const b = baseline(g);
  const votes = g.up_votes + g.down_votes;
  return {
    universe_id: Number(g.universe_id),
    name: g.name,
    creator: g.creator_name,
    genre: [g.genre_l1, g.genre_l2].filter(Boolean).join(" > ") || null,
    playing: g.playing,
    playing_1h_ago: g.p_1h,
    playing_24h_ago: g.p_24h,
    playing_7d_ago: g.p_7d,
    growth_vs: b ? { baseline: b.value, window: b.label } : null,
    rise_score: g.rise_score,
    visits_per_hour: g.visit_rate,
    pace_vs_lifetime: g.pace,
    est_session_minutes: g.est_session_min,
    peak_playing: g.peak_playing,
    visits: g.visits,
    favorites: g.favorites,
    like_ratio_pct: votes >= 5 ? Math.round((g.up_votes / votes) * 1000) / 10 : null,
    votes,
    created: day(g.created_at),
    updated: day(g.updated_at),
    charts: JSON.parse(g.charts || "[]"),
    watched: !!g.watched,
  };
}

const filterProps = {
  q: { type: "string", description: "Text in the game name or creator name" },
  min: { type: "number", description: "Minimum concurrent players (default 10)" },
  max: { type: "number", description: "Maximum concurrent players" },
  maxAge: { type: "number", description: "Only games created within this many days" },
  updatedWithin: { type: "number", description: "Only games whose developer published an update within this many days" },
  genre: { type: "string", description: "Roblox top-level genre, e.g. Simulation, Survival, RPG" },
  sub: { type: "string", description: "Roblox sub-genre, e.g. Physics Sim, Tower Defense, Incremental Simulator" },
  minLike: { type: "number", description: "Minimum like ratio percent (needs 20+ votes)" },
  chart: { type: "string", description: "Only games currently on this Roblox chart, e.g. up-and-coming, top-trending" },
  tag: { type: "string", description: "Only games carrying this tag" },
  watch: { type: "boolean", description: "Only watchlisted games" },
  sort: { type: "string", enum: ["rise", "fall", "seen", "pace", "session", "g24", "g7d", "playing", "new", "like", "visits", "updated"], description: "rise = players gained relative to size (default); pace = current visit rate against the game's lifetime average; session = longest estimated session length" },
  page: { type: "number", description: "1-based page" },
  pageSize: { type: "number", description: "Games per page, up to 200 (default 50)" },
};

export const TOOLS: Tool[] = [
  {
    name: "list_games",
    description:
      "List tracked Roblox games with filters, sorting and paging. This is the full dataset (thousands of games), not a top-10: page through it. Default sort is fastest rising. growth_vs.window says what the growth baseline is ('24h', '1h', or 'since tracked' when history is short). pace_vs_lifetime is the game's visit rate right now divided by its lifetime average rate (2 = twice its usual pace) and needs no long history. est_session_minutes is players online divided by visits per minute: an estimate of how long one visit lasts, a rough stand-in for engagement.",
    inputSchema: { type: "object", properties: filterProps },
    run: async (a) => {
      const f: Filters = { ...a, min: a.min ?? 10 };
      const { games, total } = await listGames(f);
      return { total, page: f.page ?? 1, pageSize: Math.min(f.pageSize ?? 50, 200), games: games.map(brief) };
    },
  },
  {
    name: "get_game",
    description: "Everything stored about one game: stats, description, tags, the user's playtest notes, game passes with prices, and a daily history summary.",
    inputSchema: { type: "object", properties: { universe_id: { type: "number" } }, required: ["universe_id"] },
    run: async ({ universe_id }) => {
      const g = await getGame(universe_id);
      if (!g) throw new Error(`Game ${universe_id} is not tracked. Use add_game with its Roblox link or ID.`);
      const [tags, note, passes, daily] = await Promise.all([
        getTags(universe_id),
        getNote(universe_id),
        getGamePasses(universe_id).catch(() => []),
        q<{ day: string; avg_playing: number; peak_playing: number; visits: number | null }>(
          `SELECT date(ts, 'unixepoch') AS day, ROUND(AVG(playing)) AS avg_playing, MAX(playing) AS peak_playing, MAX(visits) AS visits
           FROM snapshots WHERE universe_id = ? AND ts >= ? GROUP BY day ORDER BY day`,
          [universe_id, now() - 30 * 86400],
        ),
      ]);
      return {
        ...brief(g),
        description: g.description,
        root_place_id: g.root_place_id,
        play_url: g.root_place_id ? `https://www.roblox.com/games/${g.root_place_id}` : null,
        max_players_per_server: g.max_players,
        found_via: g.source,
        has_rolimons_backfill: !!g.backfilled,
        tags,
        notes: note?.body ?? null,
        game_passes: passes.filter((p) => p.isForSale).map((p) => ({ name: p.name, price_robux: p.price })),
        last_30_days: daily,
      };
    },
  },
  {
    name: "get_game_history",
    description: "Time series for one game (players, visits, favorites, votes). Give a day range; long ranges are evenly sampled down to max_points. src shows where each point came from (collector, rolimons, ai, you).",
    inputSchema: {
      type: "object",
      properties: {
        universe_id: { type: "number" },
        days: { type: "number", description: "How far back from now (default 7). Use 0 for all history." },
        max_points: { type: "number", description: "Default 300, max 2000" },
      },
      required: ["universe_id"],
    },
    run: async ({ universe_id, days = 7, max_points = 300 }) => {
      const rows = await getHistory(universe_id, days ? now() - days * 86400 : 0, Math.min(max_points, 2000));
      return { points: rows.length, history: rows.map((r) => ({ ...r, time: new Date(Number(r.ts) * 1000).toISOString().slice(0, 16) })) };
    },
  },
  {
    name: "list_niches",
    description:
      "Groups of similar games ranked by breadth of momentum: how many separate games in the group are hot (growing 15%+ or on Roblox's trending / up-and-coming charts), not one game's raw gain. kind: 'genre' = Roblox sub-genres (most reliable), 'tag' = AI/user theme and mechanic tags, 'keyword' = shared title words (crudest). oneHit=true means a single game drives the group. Follow up with list_games using sub=<term> (genre), tag=<term>, or q=<term> (keyword).",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["genre", "tag", "keyword"] }, min_hot: { type: "number", description: "Minimum hot games in the group (default 0)" }, limit: { type: "number", description: "Default 60" } },
    },
    run: async ({ kind, min_hot = 0, limit = 60 }) => (await getNiches(kind)).filter((n) => n.hot >= min_hot).slice(0, limit),
  },
  {
    name: "search_roblox",
    description: "Live keyword search on Roblox itself (not just the tracked set). Every result is added to tracking so it gains history. Use to explore how crowded an idea or niche is.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, pages: { type: "number", description: "Result pages to fetch, 1-5 (default 2)" } }, required: ["query"] },
    run: async ({ query, pages = 2 }) => {
      const hits = await searchGames(query, randomUUID(), Math.min(Math.max(pages, 1), 5));
      const ids = hits.map((h) => h.universeId);
      const known = ids.length ? await q<{ universe_id: number }>(`SELECT universe_id FROM games WHERE universe_id IN (${ids.join(",")})`) : [];
      const knownIds = new Set(known.map((k) => Number(k.universe_id)));
      const fresh = ids.filter((id) => !knownIds.has(id)).slice(0, 150);
      if (fresh.length) await pollGames(fresh, "search");
      const { games } = ids.length ? await listGamesByIds(ids) : { games: [] };
      return { results: games.length, newly_tracked: fresh.length, games: games.map(brief) };
    },
  },
  {
    name: "query_database",
    description:
      "Run one read-only SQL SELECT against the SQLite database for anything the other tools cannot express. Tables: games(universe_id, root_place_id, name, description, creator_id, creator_name, creator_type, genre_l1, genre_l2, max_players, created_at, updated_at, playing, visits, favorites, up_votes, down_votes, peak_playing, p_first, p_1h, p_24h, p_7d, rise_score, charts JSON, source, first_seen, last_polled, backfilled), snapshots(universe_id, ts, playing, visits, favorites, up_votes, down_votes, src), tags(universe_id, tag, src), watchlist(universe_id, added_at), notes(universe_id, body, updated_at), presets, alerts, edit_log. Times are unix seconds. Returns at most 500 rows.",
    inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
    run: async ({ sql }) => {
      if (typeof sql !== "string" || sql.length > 5000) throw new Error("Query too long");
      if (!/^\s*(select|with)\b/i.test(sql) || sql.includes(";")) throw new Error("Only a single SELECT (or WITH ... SELECT) statement is allowed");
      assertSafeQuery(sql);
      await ready();
      const tx = await db().transaction("read");
      try {
        const r = await tx.execute(sql);
        return { columns: r.columns, rows: r.rows.slice(0, 500), truncated: r.rows.length > 500 };
      } finally {
        tx.close();
      }
    },
  },
  {
    name: "get_status",
    description: "Collector health and dataset size: games tracked, snapshot count, how far back history goes, last collection time.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const s = await getStatus();
      return { ...s, oldest_snapshot: day(s.oldestSnapshot), last_cycle_at: s.lastCycle ? new Date(s.lastCycle.ts * 1000).toISOString() : null };
    },
  },
  {
    name: "list_presets_and_alerts",
    description: "The user's saved filter presets and recent alerts.",
    inputSchema: { type: "object", properties: {} },
    run: async () => ({ presets: await getPresets(), alerts: await getAlerts(50) }),
  },
  {
    name: "list_notes",
    description: "All of the user's playtest notes across games, newest first.",
    inputSchema: { type: "object", properties: {} },
    run: async () =>
      q("SELECT n.universe_id, g.name, n.body, datetime(n.updated_at, 'unixepoch') AS updated FROM notes n LEFT JOIN games g ON g.universe_id = n.universe_id ORDER BY n.updated_at DESC LIMIT 200"),
  },

  // ---- writes ----
  {
    name: "add_game",
    description: "Start tracking a game by Roblox link, place ID or universe ID, and fetch its current stats.",
    inputSchema: { type: "object", properties: { ref: { type: "string", description: "Roblox game link, place ID, or universe ID" } }, required: ["ref"] },
    run: async ({ ref }) => {
      const id = await ops.addGame(String(ref), "ai");
      return brief((await getGame(id))!);
    },
  },
  {
    name: "refresh_games",
    description: "Fetch fresh stats from Roblox right now for up to 100 tracked games and record a snapshot.",
    inputSchema: { type: "object", properties: { universe_ids: { type: "array", items: { type: "number" } } }, required: ["universe_ids"] },
    run: async ({ universe_ids }) => ({ refreshed: await pollGames((universe_ids as number[]).slice(0, 100)) }),
  },
  {
    name: "backfill_history",
    description: "Fill in a game's older history (players, visits, votes, often years back) from its public Rolimons page. Only works for games Rolimons tracks. One game per call; use sparingly.",
    inputSchema: { type: "object", properties: { universe_id: { type: "number" } }, required: ["universe_id"] },
    run: async ({ universe_id }) => {
      const r = await ops.backfillFromRolimons(universe_id, "ai");
      return { points_added: r.points, from: day(r.from), columns: r.columns };
    },
  },
  {
    name: "upsert_snapshots",
    description: "Add or correct history points for a game, e.g. to fill a gap with data from another source. Points at an existing timestamp are replaced. Logged and undoable. Say where the numbers came from in `source`.",
    inputSchema: {
      type: "object",
      properties: {
        universe_id: { type: "number" },
        source: { type: "string", description: "Short label for where the data came from, e.g. 'romonitor' or 'ai-estimate'" },
        points: {
          type: "array",
          items: {
            type: "object",
            properties: { ts: { type: "number", description: "Unix seconds" }, playing: { type: "number" }, visits: { type: "number" }, favorites: { type: "number" }, up_votes: { type: "number" }, down_votes: { type: "number" } },
            required: ["ts"],
          },
        },
      },
      required: ["universe_id", "points"],
    },
    run: async ({ universe_id, points, source }) => ({ written: await ops.upsertSnapshots(universe_id, points, "ai", source ? `ai:${String(source).slice(0, 30)}` : "ai") }),
  },
  {
    name: "delete_snapshots",
    description: "Delete history points for a game within a time range (unix seconds), optionally only those from one source. Logged and undoable.",
    inputSchema: {
      type: "object",
      properties: { universe_id: { type: "number" }, from_ts: { type: "number" }, to_ts: { type: "number" }, only_source: { type: "string" } },
      required: ["universe_id", "from_ts", "to_ts"],
    },
    run: async ({ universe_id, from_ts, to_ts, only_source }) => ({ deleted: await ops.deleteSnapshots(universe_id, from_ts, to_ts, "ai", only_source) }),
  },
  {
    name: "update_game_fields",
    description: "Correct stored fields on a game (name, description, genre_l1, genre_l2, creator_name, created_at, updated_at, playing, visits, favorites, up_votes, down_votes, peak_playing, p_first). Live fields are overwritten by the next collector poll. Logged and undoable.",
    inputSchema: { type: "object", properties: { universe_id: { type: "number" }, fields: { type: "object" } }, required: ["universe_id", "fields"] },
    run: async ({ universe_id, fields }) => {
      await ops.updateGameFields(universe_id, fields, "ai");
      return { ok: true };
    },
  },
  {
    name: "set_tags",
    description: "Add and/or remove tags on a game. Use short lowercase tags for theme and core mechanic (e.g. 'brainrot', 'tower defense', 'idle clicker') so niches can be filtered.",
    inputSchema: {
      type: "object",
      properties: { universe_id: { type: "number" }, add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } },
      required: ["universe_id"],
    },
    run: async ({ universe_id, add = [], remove = [] }) => {
      if (add.length) await ops.addTags(universe_id, add, "ai");
      if (remove.length) await ops.removeTags(universe_id, remove, "ai");
      return { tags: await getTags(universe_id) };
    },
  },
  {
    name: "set_watch",
    description: "Add a game to or remove it from the user's watchlist. Watched games are polled every 15 minutes and raise alerts on surges.",
    inputSchema: { type: "object", properties: { universe_id: { type: "number" }, watch: { type: "boolean" } }, required: ["universe_id", "watch"] },
    run: async ({ universe_id, watch }) => {
      await ops.setWatch(universe_id, !!watch, "ai");
      return { ok: true };
    },
  },
  {
    name: "set_note",
    description: "Replace the playtest note on a game. This overwrites the user's own text, so read it with get_game first and keep what they wrote unless asked otherwise. Undoable.",
    inputSchema: { type: "object", properties: { universe_id: { type: "number" }, body: { type: "string" } }, required: ["universe_id", "body"] },
    run: async ({ universe_id, body }) => {
      await ops.setNote(universe_id, String(body), "ai");
      return { ok: true };
    },
  },
  {
    name: "save_preset",
    description: "Save a named filter preset the user can click in the dashboard. filters uses the list_games filter names with string values, e.g. {\"maxAge\":\"30\",\"min\":\"50\",\"sort\":\"rise\"}.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, filters: { type: "object" } }, required: ["name", "filters"] },
    run: async ({ name, description = "", filters }) => ({
      id: await ops.savePreset(String(name), String(description), Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, String(v)])), "ai"),
    }),
  },
  {
    name: "delete_preset",
    description: "Delete a saved filter preset by id. Undoable.",
    inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    run: async ({ id }) => {
      await ops.deletePreset(id, "ai");
      return { ok: true };
    },
  },
  {
    name: "list_edits",
    description: "Recent changes made by the user or by AI, with ids that can be passed to undo_edit.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    run: async ({ limit = 50 }) =>
      q("SELECT id, datetime(ts, 'unixepoch') AS at, actor, action, detail, undo IS NOT NULL AS can_undo, undone FROM edit_log ORDER BY id DESC LIMIT ?", [Math.min(limit, 200)]),
  },
  {
    name: "undo_edit",
    description: "Reverse one logged change by its edit id.",
    inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    run: async ({ id }) => {
      await ops.undoEdit(id, "ai");
      return { ok: true };
    },
  },
];

async function listGamesByIds(ids: number[]) {
  const games = await q<Game>(
    `SELECT g.*, (SELECT 1 FROM watchlist w WHERE w.universe_id = g.universe_id) AS watched FROM games g WHERE g.universe_id IN (${ids.map(Number).filter(Number.isFinite).join(",")}) ORDER BY g.playing DESC`,
  );
  return { games };
}
