// One-off: copy everything collected in the local file (data/radar.db) into
// the hosted Turso database named in .env.local.
//   npx tsx --env-file=.env.local scripts/migrate-to-turso.ts
import { createClient, type InStatement, type InValue } from "@libsql/client";
import { db, ready } from "../src/lib/db";

const TABLES = ["games", "snapshots", "tags", "watchlist", "notes", "presets", "alerts", "edit_log", "kv", "chats", "chat_messages", "ai_usage", "rbx_keys", "my_games", "findings"];

(async () => {
  if (!process.env.TURSO_DATABASE_URL?.startsWith("libsql://")) throw new Error("TURSO_DATABASE_URL is not set to a libsql:// address");
  const local = createClient({ url: "file:data/radar.db" });
  await ready(); // creates the tables on Turso
  const remote = db();
  await remote.execute("DELETE FROM presets"); // the local copy carries the presets, including defaults

  for (const table of TABLES) {
    let rows;
    try {
      rows = await local.execute(`SELECT * FROM ${table}`);
    } catch {
      continue; // table does not exist locally yet
    }
    const cols = rows.columns;
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    const stmts: InStatement[] = rows.rows.map((r) => ({ sql, args: cols.map((_, i) => r[i] as InValue) }));
    for (let i = 0; i < stmts.length; i += 200) await remote.batch(stmts.slice(i, i + 200), "write");
    const check = await remote.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    console.log(`${table}: ${rows.rows.length} local -> ${check.rows[0].n} on Turso`);
  }
  process.exit(0);
})().catch((e) => {
  console.error("migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
