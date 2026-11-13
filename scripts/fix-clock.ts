// One-off repair: early collection runs on a PC whose clock was hours slow
// stamped rows with the wrong time. This shifts those rows to real time.
//   npx tsx --env-file-if-exists=.env.local scripts/fix-clock.ts
//
// How rows are told apart: the PC's clock was behind, so everything it wrote
// has a timestamp earlier than CUTOFF, while rows written by machines with a
// correct clock (GitHub's servers, Rolimons history) are later. Rolimons
// history was always real time and is left alone.
import { clockOffsetSeconds } from "../src/lib/clock";
import { db, now, ready } from "../src/lib/db";

(async () => {
  await ready();
  const shift = clockOffsetSeconds();
  if (Math.abs(shift) < 600) {
    console.log(`This machine's clock is within ${Math.abs(shift)}s of real time; nothing to repair from here.`);
    process.exit(0);
  }
  const c = db();
  // Anything stamped before "this machine's idea of now" plus a small margin was written with the slow clock.
  const cutoff = now() - shift + 300;
  const done = (await c.execute("SELECT value FROM kv WHERE key = 'clock_fix'")).rows[0];
  if (done) {
    console.log("Already repaired:", done.value);
    process.exit(0);
  }
  console.log(`Clock is off by ${shift}s. Shifting rows stamped before ${new Date(cutoff * 1000).toISOString()}.`);

  // Snapshots: move in descending order so shifted rows never collide with unshifted ones.
  const snaps = await c.execute({ sql: "SELECT universe_id, ts FROM snapshots WHERE src = 'collector' AND ts < ? ORDER BY ts DESC", args: [cutoff] });
  for (let i = 0; i < snaps.rows.length; i += 300) {
    await c.batch(
      snaps.rows.slice(i, i + 300).map((r) => ({ sql: "UPDATE OR REPLACE snapshots SET ts = ts + ? WHERE universe_id = ? AND ts = ?", args: [shift, r.universe_id, r.ts] })),
      "write",
    );
  }
  console.log(`snapshots shifted: ${snaps.rows.length}`);

  const r1 = await c.execute({ sql: "UPDATE games SET first_seen = first_seen + ? WHERE first_seen < ?", args: [shift, cutoff] });
  const r2 = await c.execute({ sql: "UPDATE games SET last_polled = last_polled + ? WHERE last_polled IS NOT NULL AND last_polled < ?", args: [shift, cutoff] });
  const r3 = await c.execute({ sql: "UPDATE games SET charts_seen = charts_seen + ? WHERE charts_seen IS NOT NULL AND charts_seen < ?", args: [shift, cutoff] });
  // Poll everything again soon, and drop figures that were computed from mixed clocks; the next polls rebuild them.
  const r4 = await c.execute({ sql: "UPDATE games SET next_poll = 0, p_1h = NULL, p_24h = NULL, p_7d = NULL, rise_score = 0, visit_rate = NULL, pace = NULL, est_session_min = NULL WHERE next_poll < ? OR pace IS NOT NULL", args: [cutoff + 86400] });
  for (const [table, col] of [["watchlist", "added_at"], ["notes", "updated_at"], ["alerts", "ts"], ["edit_log", "ts"]] as const) {
    await c.execute({ sql: `UPDATE ${table} SET ${col} = ${col} + ? WHERE ${col} < ?`, args: [shift, cutoff] });
  }
  console.log(`games: first_seen ${r1.rowsAffected}, last_polled ${r2.rowsAffected}, charts_seen ${r3.rowsAffected}, reset ${r4.rowsAffected}`);
  await c.execute({ sql: "INSERT INTO kv (key, value) VALUES ('clock_fix', ?)", args: [`shifted ${snaps.rows.length} snapshots by ${shift}s`] });
  process.exit(0);
})().catch((e) => {
  console.error("repair failed:", e);
  process.exit(1);
});
