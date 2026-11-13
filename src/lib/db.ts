import { createClient, type Client, type InValue } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { nowMs, syncClock } from "./clock";

// One database for everything. Locally it is a SQLite file; in production
// set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN and the same code talks to Turso.

const g = globalThis as unknown as { __radarDb?: Client; __radarSchema?: Promise<void> };

export function db(): Client {
  if (!g.__radarDb) {
    const url = process.env.TURSO_DATABASE_URL?.trim() || "file:data/radar.db";
    if (url.startsWith("file:")) mkdirSync("data", { recursive: true });
    g.__radarDb = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN?.trim() });
  }
  return g.__radarDb;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS games (
    universe_id INTEGER PRIMARY KEY,
    root_place_id INTEGER,
    name TEXT NOT NULL DEFAULT '',
    description TEXT,
    creator_id INTEGER,
    creator_name TEXT,
    creator_type TEXT,
    genre_l1 TEXT,
    genre_l2 TEXT,
    max_players INTEGER,
    created_at INTEGER,
    updated_at INTEGER,
    playing INTEGER NOT NULL DEFAULT 0,
    visits INTEGER NOT NULL DEFAULT 0,
    favorites INTEGER NOT NULL DEFAULT 0,
    up_votes INTEGER NOT NULL DEFAULT 0,
    down_votes INTEGER NOT NULL DEFAULT 0,
    peak_playing INTEGER NOT NULL DEFAULT 0,
    p_first INTEGER,
    p_1h INTEGER,
    p_24h INTEGER,
    p_7d INTEGER,
    rise_score REAL NOT NULL DEFAULT 0,
    charts TEXT NOT NULL DEFAULT '[]',
    charts_seen INTEGER,
    source TEXT NOT NULL DEFAULT 'charts',
    first_seen INTEGER NOT NULL,
    last_polled INTEGER,
    next_poll INTEGER NOT NULL DEFAULT 0,
    backfilled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS games_next_poll ON games(next_poll)`,
  `CREATE INDEX IF NOT EXISTS games_playing ON games(playing)`,
  `CREATE INDEX IF NOT EXISTS games_rise ON games(rise_score)`,
  `CREATE INDEX IF NOT EXISTS games_created ON games(created_at)`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    universe_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    playing INTEGER,
    visits INTEGER,
    favorites INTEGER,
    up_votes INTEGER,
    down_votes INTEGER,
    src TEXT NOT NULL DEFAULT 'collector',
    PRIMARY KEY (universe_id, ts)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS tags (
    universe_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    src TEXT NOT NULL DEFAULT 'user',
    PRIMARY KEY (universe_id, tag)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS watchlist (
    universe_id INTEGER PRIMARY KEY,
    added_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    universe_id INTEGER PRIMARY KEY,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    filters TEXT NOT NULL,
    src TEXT NOT NULL DEFAULT 'user'
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    universe_id INTEGER,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    ts INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS edit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    undo TEXT,
    undone INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    grade TEXT,
    grade_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    chat_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY (chat_id, seq)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rbx_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    api_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS my_games (
    universe_id INTEGER PRIMARY KEY,
    key_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    added_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS metric_cache (
    universe_id INTEGER NOT NULL,
    cache_key TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (universe_id, cache_key)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    universe_id INTEGER NOT NULL,
    run_ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT,
    title TEXT NOT NULL,
    evidence TEXT NOT NULL,
    confidence TEXT,
    dismissed INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS icons (
    universe_id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

const DEFAULT_PRESETS: { name: string; description: string; filters: Record<string, string> }[] = [
  { name: "Fresh and climbing", description: "Under 30 days old, 50+ players, sorted by rise", filters: { maxAge: "30", min: "50", sort: "rise" } },
  { name: "Tiny but loved", description: "10-300 players with a 90%+ like ratio", filters: { min: "10", max: "300", minLike: "90", sort: "rise" } },
  { name: "Breakouts this week", description: "Any age, biggest 7-day growth", filters: { min: "100", sort: "g7d" } },
  { name: "Solo-dev sized", description: "Under 60 days old, 50-2,000 players", filters: { maxAge: "60", min: "50", max: "2000", sort: "rise" } },
  { name: "Updated and climbing", description: "Published an update in the last 7 days and is gaining players", filters: { updatedWithin: "7", min: "50", sort: "rise" } },
  { name: "Above their usual pace", description: "Getting visits faster than their lifetime average", filters: { min: "50", sort: "pace" } },
  { name: "Losing players", description: "100+ players and falling fastest", filters: { min: "100", sort: "fall" } },
  { name: "Newly spotted", description: "Games the tracker found most recently", filters: { min: "10", sort: "seen" } },
];

export function ready(): Promise<void> {
  if (!g.__radarSchema) {
    g.__radarSchema = (async () => {
      const c = db();
      await syncClock();
      for (const sql of SCHEMA) await c.execute(sql);
      // Columns added after the first release. SQLite has no "ADD COLUMN IF NOT EXISTS".
      for (const col of ["visit_rate REAL", "pace REAL", "est_session_min REAL"]) {
        try {
          await c.execute(`ALTER TABLE games ADD COLUMN ${col}`);
        } catch {
          // already there
        }
      }
      // Built-in presets are added once each; deleting one keeps it deleted.
      const seeded = new Set<string>(JSON.parse(String((await c.execute("SELECT value FROM kv WHERE key = 'seeded_presets'")).rows[0]?.value ?? "[]")));
      const have = new Set((await c.execute("SELECT name FROM presets")).rows.map((r) => String(r.name)));
      for (const p of DEFAULT_PRESETS) {
        if (seeded.has(p.name)) continue;
        if (!have.has(p.name)) {
          await c.execute({
            sql: "INSERT INTO presets (name, description, filters, src) VALUES (?, ?, ?, 'default')",
            args: [p.name, p.description, JSON.stringify(p.filters)],
          });
        }
        seeded.add(p.name);
      }
      await c.execute({ sql: "INSERT INTO kv (key, value) VALUES ('seeded_presets', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [JSON.stringify([...seeded])] });
    })();
  }
  return g.__radarSchema;
}

export async function q<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T[]> {
  await ready();
  const r = await db().execute({ sql, args });
  // Plain objects, so rows can be handed straight to client components.
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) as T[];
}

export async function run(sql: string, args: InValue[] = []) {
  await ready();
  return db().execute({ sql, args });
}

export async function kvGet(key: string): Promise<string | null> {
  const r = await q<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]);
  return r[0]?.value ?? null;
}

export async function kvSet(key: string, value: string) {
  await run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}

export const now = () => Math.floor(nowMs() / 1000);

/** Every data change made by a person or an AI is logged so it can be undone. */
export async function logEdit(actor: string, action: string, detail: unknown, undo?: { sql: string; args: InValue[] }[]) {
  await run("INSERT INTO edit_log (ts, actor, action, detail, undo) VALUES (?, ?, ?, ?, ?)", [
    now(),
    actor,
    action,
    JSON.stringify(detail),
    undo ? JSON.stringify(undo) : null,
  ]);
}
