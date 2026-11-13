import type { InStatement, InValue } from "@libsql/client";
import { db, logEdit, now, q, run } from "./db";
import { pollGames } from "./collector";

// Every change a person or an AI can make goes through here, so the dashboard
// and the MCP endpoint behave identically and every change lands in edit_log.

export type Actor = "you" | "ai";

/** Accepts a universe ID, a place ID, or any roblox.com/games/... link. */
export async function resolveUniverse(ref: string): Promise<number> {
  const m = String(ref).match(/games\/(\d+)/) ?? String(ref).match(/placeId=(\d+)/i);
  const num = Number(m ? m[1] : String(ref).trim());
  if (!Number.isFinite(num) || num <= 0) throw new Error(`Not a game ID or link: ${ref}`);
  if (!m) {
    const known = await q("SELECT 1 FROM games WHERE universe_id = ?", [num]);
    if (known.length) return num;
  }
  // Treat it as a place ID first (that is what links and most people use).
  try {
    const r = await fetch(`https://apis.roblox.com/universes/v1/places/${num}/universe`, { signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const j = (await r.json()) as { universeId: number | null };
      if (j.universeId) return j.universeId;
    }
  } catch {
    // fall through and try it as a universe ID
  }
  return num;
}

export async function addGame(ref: string, actor: Actor) {
  const id = await resolveUniverse(ref);
  const n = await pollGames([id], "manual");
  if (!n) throw new Error(`Roblox returned no game for ${ref}`);
  await logEdit(actor, "add_game", { universe_id: id });
  return id;
}

export async function setWatch(id: number, on: boolean, actor: Actor) {
  if (on) await run("INSERT OR IGNORE INTO watchlist (universe_id, added_at) VALUES (?, ?)", [id, now()]);
  else await run("DELETE FROM watchlist WHERE universe_id = ?", [id]);
  // Watched games are polled on the fast tier from now on.
  if (on) await run("UPDATE games SET next_poll = MIN(next_poll, ?) WHERE universe_id = ?", [now(), id]);
  await logEdit(actor, on ? "watch" : "unwatch", { universe_id: id }, [
    on ? { sql: "DELETE FROM watchlist WHERE universe_id = ?", args: [id] } : { sql: "INSERT OR IGNORE INTO watchlist (universe_id, added_at) VALUES (?, ?)", args: [id, now()] },
  ]);
}

export async function setNote(id: number, body: string, actor: Actor) {
  const prev = await q<{ body: string; updated_at: number }>("SELECT body, updated_at FROM notes WHERE universe_id = ?", [id]);
  if (body.trim()) {
    await run("INSERT INTO notes (universe_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(universe_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at", [id, body, now()]);
  } else {
    await run("DELETE FROM notes WHERE universe_id = ?", [id]);
  }
  await logEdit(actor, "set_note", { universe_id: id, length: body.length }, [
    prev[0]
      ? { sql: "INSERT INTO notes (universe_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(universe_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at", args: [id, prev[0].body, prev[0].updated_at] }
      : { sql: "DELETE FROM notes WHERE universe_id = ?", args: [id] },
  ]);
}

const cleanTag = (t: string) => t.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 40);

export async function addTags(id: number, tags: string[], actor: Actor) {
  const clean = [...new Set(tags.map(cleanTag).filter(Boolean))];
  for (const t of clean) await run("INSERT OR IGNORE INTO tags (universe_id, tag, src) VALUES (?, ?, ?)", [id, t, actor]);
  await logEdit(actor, "add_tags", { universe_id: id, tags: clean }, clean.map((t) => ({ sql: "DELETE FROM tags WHERE universe_id = ? AND tag = ?", args: [id, t] })));
  return clean;
}

export async function removeTags(id: number, tags: string[], actor: Actor) {
  const clean = tags.map(cleanTag);
  for (const t of clean) await run("DELETE FROM tags WHERE universe_id = ? AND tag = ?", [id, t]);
  await logEdit(actor, "remove_tags", { universe_id: id, tags: clean }, clean.map((t) => ({ sql: "INSERT OR IGNORE INTO tags (universe_id, tag, src) VALUES (?, ?, ?)", args: [id, t, actor] })));
}

export async function savePreset(name: string, description: string, filters: Record<string, string>, actor: Actor) {
  const r = await run("INSERT INTO presets (name, description, filters, src) VALUES (?, ?, ?, ?)", [name, description, JSON.stringify(filters), actor]);
  const id = Number(r.lastInsertRowid);
  await logEdit(actor, "save_preset", { id, name, filters }, [{ sql: "DELETE FROM presets WHERE id = ?", args: [id] }]);
  return id;
}

export async function deletePreset(id: number, actor: Actor) {
  const prev = await q<{ name: string; description: string | null; filters: string; src: string }>("SELECT name, description, filters, src FROM presets WHERE id = ?", [id]);
  if (!prev[0]) throw new Error(`No preset ${id}`);
  await run("DELETE FROM presets WHERE id = ?", [id]);
  await logEdit(actor, "delete_preset", { id, name: prev[0].name }, [
    { sql: "INSERT INTO presets (id, name, description, filters, src) VALUES (?, ?, ?, ?, ?)", args: [id, prev[0].name, prev[0].description, prev[0].filters, prev[0].src] },
  ]);
}

export type SnapshotInput = { ts: number; playing?: number | null; visits?: number | null; favorites?: number | null; up_votes?: number | null; down_votes?: number | null };

/** Add or correct history points. Existing points at the same time are replaced and restorable via undo. */
export async function upsertSnapshots(id: number, points: SnapshotInput[], actor: Actor, src?: string) {
  if (!points.length) return 0;
  if (points.length > 5000) throw new Error("At most 5000 points per call");
  const tsList = points.map((p) => Math.floor(Number(p.ts)));
  if (tsList.some((t) => !Number.isFinite(t) || t < 1136073600 || t > now() + 3600)) throw new Error("ts must be unix seconds between 2006 and now");
  const prev = await q<Record<string, InValue>>(
    `SELECT universe_id, ts, playing, visits, favorites, up_votes, down_votes, src FROM snapshots WHERE universe_id = ? AND ts IN (${tsList.join(",")})`,
    [id],
  );
  const stmts: InStatement[] = points.map((p, i) => ({
    sql: "INSERT OR REPLACE INTO snapshots (universe_id, ts, playing, visits, favorites, up_votes, down_votes, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, tsList[i], p.playing ?? null, p.visits ?? null, p.favorites ?? null, p.up_votes ?? null, p.down_votes ?? null, src ?? actor],
  }));
  await db().batch(stmts, "write");
  const undo: { sql: string; args: InValue[] }[] = [
    { sql: `DELETE FROM snapshots WHERE universe_id = ? AND ts IN (${tsList.join(",")})`, args: [id] },
    ...prev.map((r) => ({
      sql: "INSERT OR REPLACE INTO snapshots (universe_id, ts, playing, visits, favorites, up_votes, down_votes, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [r.universe_id, r.ts, r.playing, r.visits, r.favorites, r.up_votes, r.down_votes, r.src],
    })),
  ];
  await logEdit(actor, "upsert_snapshots", { universe_id: id, points: points.length, src: src ?? actor }, undo);
  return points.length;
}

export async function deleteSnapshots(id: number, fromTs: number, toTs: number, actor: Actor, onlySrc?: string) {
  const cond = "universe_id = ? AND ts BETWEEN ? AND ?" + (onlySrc ? " AND src = ?" : "");
  const args: InValue[] = onlySrc ? [id, fromTs, toTs, onlySrc] : [id, fromTs, toTs];
  const prev = await q<Record<string, InValue>>(`SELECT universe_id, ts, playing, visits, favorites, up_votes, down_votes, src FROM snapshots WHERE ${cond}`, args);
  if (prev.length > 20000) throw new Error(`That would delete ${prev.length} points; narrow the range (max 20000)`);
  await run(`DELETE FROM snapshots WHERE ${cond}`, args);
  await logEdit(actor, "delete_snapshots", { universe_id: id, fromTs, toTs, onlySrc, deleted: prev.length }, prev.map((r) => ({
    sql: "INSERT OR REPLACE INTO snapshots (universe_id, ts, playing, visits, favorites, up_votes, down_votes, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [r.universe_id, r.ts, r.playing, r.visits, r.favorites, r.up_votes, r.down_votes, r.src],
  })));
  return prev.length;
}

const EDITABLE = new Set(["name", "description", "genre_l1", "genre_l2", "creator_name", "created_at", "updated_at", "playing", "visits", "favorites", "up_votes", "down_votes", "peak_playing", "p_first"]);

/** Correct stored fields on a game. The collector will overwrite live fields on its next poll. */
export async function updateGameFields(id: number, fields: Record<string, InValue>, actor: Actor) {
  const keys = Object.keys(fields);
  const bad = keys.filter((k) => !EDITABLE.has(k));
  if (bad.length) throw new Error(`Not editable: ${bad.join(", ")}. Editable: ${[...EDITABLE].join(", ")}`);
  if (!keys.length) return;
  const prev = await q<Record<string, InValue>>(`SELECT ${keys.join(", ")} FROM games WHERE universe_id = ?`, [id]);
  if (!prev[0]) throw new Error(`Game ${id} is not tracked; add it first`);
  await run(`UPDATE games SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE universe_id = ?`, [...keys.map((k) => fields[k]), id]);
  await logEdit(actor, "update_game_fields", { universe_id: id, fields }, [
    { sql: `UPDATE games SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE universe_id = ?`, args: [...keys.map((k) => prev[0][k]), id] },
  ]);
}

export async function undoEdit(editId: number, actor: Actor) {
  const r = await q<{ undo: string | null; undone: number; action: string }>("SELECT undo, undone, action FROM edit_log WHERE id = ?", [editId]);
  if (!r[0]) throw new Error(`No edit ${editId}`);
  if (r[0].undone) throw new Error(`Edit ${editId} was already undone`);
  if (!r[0].undo) throw new Error(`Edit ${editId} (${r[0].action}) cannot be undone`);
  const stmts = JSON.parse(r[0].undo) as InStatement[];
  for (let i = 0; i < stmts.length; i += 200) await db().batch(stmts.slice(i, i + 200), "write");
  await run("UPDATE edit_log SET undone = 1 WHERE id = ?", [editId]);
  await logEdit(actor, "undo", { edit: editId, action: r[0].action });
}

/**
 * Pull a game's older history from its public Rolimons page. One page per
 * call, on demand only. Points closer than an hour apart are skipped.
 */
export async function backfillFromRolimons(id: number, actor: Actor) {
  const g = await q<{ root_place_id: number | null }>("SELECT root_place_id FROM games WHERE universe_id = ?", [id]);
  if (!g[0]?.root_place_id) throw new Error(`Game ${id} is not tracked yet; add it first`);
  const res = await fetch(`https://www.rolimons.com/game/${g[0].root_place_id}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Rolimons returned ${res.status}; it may not track this game`);
  const html = await res.text();
  const m = html.match(/<script[^>]*id="game_history_json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Rolimons has no history for this game (or its page layout changed)");
  const h = JSON.parse(m[1]) as Record<string, number[] | number>;
  const ts = h.timestamps as number[];
  if (!Array.isArray(ts) || !ts.length) throw new Error("Rolimons history was empty");
  const col = (k: string) => (Array.isArray(h[k]) ? (h[k] as number[]) : null);
  const players = col("players");
  const visits = col("visits");
  const up = col("upvotes");
  const down = col("downvotes");
  const fav = col("favorites");

  const stmts: InStatement[] = [];
  let last = 0;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] - last < 3600) continue;
    last = ts[i];
    stmts.push({
      sql: "INSERT OR IGNORE INTO snapshots (universe_id, ts, playing, visits, favorites, up_votes, down_votes, src) VALUES (?, ?, ?, ?, ?, ?, ?, 'rolimons')",
      args: [id, ts[i], players?.[i] ?? null, visits?.[i] ?? null, fav?.[i] ?? null, up?.[i] ?? null, down?.[i] ?? null],
    });
  }
  for (let i = 0; i < stmts.length; i += 500) await db().batch(stmts.slice(i, i + 500), "write");
  await run("UPDATE games SET backfilled = 1, peak_playing = MAX(peak_playing, ?) WHERE universe_id = ?", [players ? Math.max(...players) : 0, id]);
  await logEdit(actor, "backfill_rolimons", { universe_id: id, points: stmts.length, from: ts[0] }, [
    { sql: "DELETE FROM snapshots WHERE universe_id = ? AND src = 'rolimons'", args: [id] },
    { sql: "UPDATE games SET backfilled = 0 WHERE universe_id = ?", args: [id] },
  ]);
  return { points: stmts.length, from: ts[0], columns: Object.keys(h).filter((k) => Array.isArray(h[k])) };
}
