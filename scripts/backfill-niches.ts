// Rebuilds niche history from the per-game snapshots already stored, so the
// niche charts start with whatever history exists instead of empty.
// Safe to re-run: it never overwrites rows the collector wrote.
//   npx tsx scripts/backfill-niches.ts
try {
  process.loadEnvFile(".env.local");
} catch {}

export {};

async function main() {
  const { ready, q, db, now } = await import("../src/lib/db");
  const { freshNiches, terms } = await import("../src/lib/niches");
  await ready();
  const HOUR = 3600;
  const from = now() - 30 * 86400;

  const [games, tagRows, snaps, niches] = await Promise.all([
    q<{ universe_id: number; name: string; genre_l1: string | null; genre_l2: string | null; created_at: number | null }>("SELECT universe_id, name, genre_l1, genre_l2, created_at FROM games"),
    q<{ universe_id: number; tag: string }>("SELECT universe_id, tag FROM tags"),
    q<{ universe_id: number; ts: number; playing: number }>("SELECT universe_id, ts, playing FROM snapshots WHERE ts >= ? AND playing IS NOT NULL ORDER BY universe_id, ts", [from]),
    freshNiches(),
  ]);
  const wanted = new Set(niches.map((n) => `${n.kind}|${n.term}`));
  const tagsOf = new Map<number, string[]>();
  for (const t of tagRows) (tagsOf.get(Number(t.universe_id)) ?? tagsOf.set(Number(t.universe_id), []).get(Number(t.universe_id))!).push(t.tag);

  // Which niches each game belongs to.
  const member = new Map<number, string[]>();
  const created = new Map<number, number | null>();
  for (const g of games) {
    const id = Number(g.universe_id);
    const keys: string[] = [];
    const genre = g.genre_l2 || g.genre_l1;
    if (genre) keys.push(`genre|${genre}`);
    for (const t of tagsOf.get(id) ?? []) keys.push(`tag|${t}`);
    for (const t of terms(g.name)) keys.push(`keyword|${t}`);
    member.set(id, keys.filter((k) => wanted.has(k)));
    created.set(id, g.created_at);
  }

  const byGame = new Map<number, { ts: number; playing: number }[]>();
  for (const s of snaps) (byGame.get(Number(s.universe_id)) ?? byGame.set(Number(s.universe_id), []).get(Number(s.universe_id))!).push({ ts: Number(s.ts), playing: Number(s.playing) });

  const first = Math.ceil(snaps.reduce((m, s) => Math.min(m, Number(s.ts)), Infinity) / HOUR) * HOUR;
  const last = Math.floor(now() / HOUR) * HOUR - HOUR;
  let written = 0;
  for (let h = first; h <= last; h += HOUR) {
    const sums = new Map<string, { players: number; games: number; fresh: number }>();
    let known = 0;
    for (const [id, pts] of byGame) {
      // Latest reading at or before the end of this hour, if it is under 26 hours old.
      let v: number | null = null;
      for (let i = pts.length - 1; i >= 0; i--) {
        if (pts[i].ts < h + HOUR) {
          if (h + HOUR - pts[i].ts <= 26 * HOUR) v = pts[i].playing;
          break;
        }
      }
      if (v == null) continue;
      known++;
      if (v < 20) continue;
      const c = created.get(id);
      for (const k of member.get(id) ?? []) {
        const cur = sums.get(k) ?? { players: 0, games: 0, fresh: 0 };
        cur.players += v;
        cur.games++;
        if (c && h - c < 30 * 86400) cur.fresh++;
        sums.set(k, cur);
      }
    }
    if (known < byGame.size * 0.8) continue; // tracking was still filling up: counts would look like growth
    const stmts = [...sums.entries()].map(([k, v]) => {
      const [kind, term] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
      return { sql: "INSERT OR IGNORE INTO niche_history (kind, term, ts, games, hot, fresh, players) VALUES (?, ?, ?, ?, NULL, ?, ?)", args: [kind, term, h, v.games, v.fresh, v.players] };
    });
    for (let i = 0; i < stmts.length; i += 200) await db().batch(stmts.slice(i, i + 200), "write");
    written += stmts.length;
    console.log(new Date(h * 1000).toISOString().slice(0, 13), `${known} games known, ${stmts.length} niches`);
  }
  console.log(`done: ${written} rows`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
