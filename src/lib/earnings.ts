import { pollGames } from "./collector";
import { kvGet, kvSet, now, q } from "./db";
import { getGame, iconsFor } from "./queries";
import { scoped } from "./scope";

// Data behind the earnings calculator: exchange rates, how many visits a game
// gets per day, and each person's saved list of games to keep an eye on.

export type Rates = { eur: number; sek: number; date: string };
const FALLBACK: Rates = { eur: 0.905, sek: 10.05, date: "" };

/** USD to EUR and SEK from the European Central Bank's daily rates (via frankfurter.dev), kept for 12 hours. */
export async function getRates(): Promise<Rates> {
  const stored = await kvGet("fx_rates").catch(() => null);
  const cached = stored ? (JSON.parse(stored) as Rates & { at: number }) : null;
  if (cached && now() - cached.at < 12 * 3600) return cached;
  try {
    const r = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=SEK,EUR", { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { date?: string; rates?: { EUR?: number; SEK?: number } };
    if (!r.ok || !j.rates?.EUR || !j.rates?.SEK) throw new Error("no rates");
    const fresh = { eur: j.rates.EUR, sek: j.rates.SEK, date: j.date ?? "" };
    await kvSet("fx_rates", JSON.stringify({ ...fresh, at: now() })).catch(() => {});
    return fresh;
  } catch {
    return cached ?? FALLBACK;
  }
}

export type GameEstimate = { id: number; name: string; playing: number; visits: number; visitsPerDay: number | null; basis: string; icon: string | null };

/** A game's visits per day, measured from the tracker's own readings of its visit counter. */
export async function estimateGame(id: number): Promise<GameEstimate | null> {
  let game = await getGame(id);
  if (!game) {
    await pollGames([id], "manual").catch(() => 0);
    game = await getGame(id);
  }
  if (!game) return null;
  const t = now();
  const snaps = await q<{ ts: number; visits: number }>("SELECT ts, visits FROM snapshots WHERE universe_id = ? AND ts >= ? AND visits IS NOT NULL ORDER BY ts", [id, t - 26 * 3600]);
  let visitsPerDay: number | null = null;
  let basis = "";
  if (snaps.length >= 2) {
    const a = snaps[0];
    const b = snaps[snaps.length - 1];
    const span = Number(b.ts) - Number(a.ts);
    if (span >= 3 * 3600 && Number(b.visits) >= Number(a.visits)) {
      visitsPerDay = Math.round(((Number(b.visits) - Number(a.visits)) / span) * 86400);
      basis = span >= 20 * 3600 ? "measured over the last 24 hours" : `measured over ${Math.round(span / 3600)} hours, scaled to a day`;
    }
  }
  if (visitsPerDay == null && game.visit_rate != null) {
    visitsPerDay = Math.round(game.visit_rate * 24);
    basis = "from the current hourly rate";
  }
  const icons = await iconsFor([id]).catch(() => new Map<number, string>());
  return { id, name: game.name, playing: game.playing, visits: game.visits, visitsPerDay, basis, icon: icons.get(id) ?? null };
}

const MAX_SAVED = 24;
const key = (uid: number) => scoped("earnings_games", uid);

export async function savedIds(uid: number): Promise<number[]> {
  const raw = await kvGet(key(uid));
  const ids = raw ? (JSON.parse(raw) as unknown) : [];
  return Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

export async function saveGame(uid: number, id: number) {
  const ids = await savedIds(uid);
  await kvSet(key(uid), JSON.stringify([id, ...ids.filter((x) => x !== id)].slice(0, MAX_SAVED)));
}

export async function unsaveGame(uid: number, id: number) {
  await kvSet(key(uid), JSON.stringify((await savedIds(uid)).filter((x) => x !== id)));
}

export async function savedGames(uid: number): Promise<GameEstimate[]> {
  const out = await Promise.all((await savedIds(uid)).map((id) => estimateGame(id).catch(() => null)));
  return out.filter((g): g is GameEstimate => !!g);
}
