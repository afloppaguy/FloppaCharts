// Thin client for Roblox's public (no-login) endpoints, with per-host pacing.
// Measured limits (Nov 2026): games.roblox.com tolerates roughly 20 requests a
// minute per IP; the explore and search APIs are looser.

const GAP_MS: Record<string, number> = {
  "games.roblox.com": 3100,
  "apis.roblox.com": 700,
  "thumbnails.roblox.com": 500,
};
const lastCall: Record<string, number> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const stats = { requests: 0, rateLimited: 0 };

export async function rbx<T>(url: string, tries = 5): Promise<T> {
  const host = new URL(url).host;
  for (let attempt = 0; attempt < tries; attempt++) {
    const wait = (lastCall[host] ?? 0) + (GAP_MS[host] ?? 500) - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall[host] = Date.now();
    stats.requests++;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
    } catch {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      stats.rateLimited++;
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? "10");
      await sleep(Math.min(Math.max(reset, 5), 60) * 1000 + 500);
      continue;
    }
    if (res.status >= 500) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Roblox ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }
  throw new Error(`Roblox gave up after ${tries} tries: ${url}`);
}

export type ChartGame = {
  universeId: number;
  rootPlaceId: number;
  name: string;
  playerCount: number;
  totalUpVotes: number;
  totalDownVotes: number;
  genreL1?: string;
};
type Sort = { sortId: string; sortDisplayName?: string; contentType: string; games?: ChartGame[] };

/** All chart lists (about 26, ~100 games each) for one device + country view. */
export async function getCharts(sessionId: string, device = "computer", country = "all") {
  const out: { sortId: string; name: string; games: ChartGame[] }[] = [];
  let token = "";
  for (let page = 0; page < 12; page++) {
    const u = new URL("https://apis.roblox.com/explore-api/v1/get-sorts");
    u.searchParams.set("sessionId", sessionId);
    u.searchParams.set("device", device);
    u.searchParams.set("country", country);
    if (token) u.searchParams.set("sortsPageToken", token);
    const d = await rbx<{ sorts: Sort[]; nextSortsPageToken?: string }>(u.toString());
    for (const s of d.sorts ?? []) {
      if (s.contentType === "Games" && s.games?.length) out.push({ sortId: s.sortId, name: s.sortDisplayName ?? s.sortId, games: s.games });
    }
    token = d.nextSortsPageToken ?? "";
    if (!token) break;
  }
  return out;
}

export type GameDetail = {
  id: number;
  rootPlaceId: number;
  name: string;
  description: string | null;
  creator: { id: number; name: string; type: string };
  playing: number;
  visits: number;
  maxPlayers: number;
  created: string;
  updated: string;
  genre_l1?: string;
  genre_l2?: string;
  favoritedCount: number;
};

/** Up to 50 universe IDs per call. */
export async function getDetails(ids: number[]): Promise<GameDetail[]> {
  if (!ids.length) return [];
  const d = await rbx<{ data: GameDetail[] }>(`https://games.roblox.com/v1/games?universeIds=${ids.join(",")}`);
  return d.data ?? [];
}

/** Up to 100 universe IDs per call. */
export async function getVotes(ids: number[]): Promise<Map<number, { up: number; down: number }>> {
  const m = new Map<number, { up: number; down: number }>();
  if (!ids.length) return m;
  const d = await rbx<{ data: { id: number; upVotes: number; downVotes: number }[] }>(
    `https://games.roblox.com/v1/games/votes?universeIds=${ids.join(",")}`,
  );
  for (const v of d.data ?? []) m.set(v.id, { up: v.upVotes, down: v.downVotes });
  return m;
}

export async function getIcons(ids: number[]): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  // Roblox renders the large size on demand and answers "pending" until it is
  // ready, so anything missing falls back to the small size it always has.
  for (const size of ["256x256", "150x150"]) {
    const missing = ids.filter((id) => !m.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const d = await rbx<{ data: { targetId: number; imageUrl: string | null }[] }>(
        `https://thumbnails.roblox.com/v1/games/icons?size=${size}&format=Png&isCircular=false&universeIds=${missing.slice(i, i + 100).join(",")}`,
      );
      for (const t of d.data ?? []) if (t.imageUrl) m.set(t.targetId, t.imageUrl);
    }
    if (m.size === ids.length) break;
  }
  return m;
}

export type SearchHit = { universeId: number; rootPlaceId: number; name: string; playerCount: number; totalUpVotes: number; totalDownVotes: number };

export async function searchGames(query: string, sessionId: string, pages = 3): Promise<SearchHit[]> {
  const hits = new Map<number, SearchHit>();
  let token = "";
  for (let p = 0; p < pages; p++) {
    const u = new URL("https://apis.roblox.com/search-api/omni-search");
    u.searchParams.set("searchQuery", query);
    u.searchParams.set("sessionId", sessionId);
    u.searchParams.set("pageType", "all");
    if (token) u.searchParams.set("pageToken", token);
    const d = await rbx<{ searchResults?: { contents?: SearchHit[] }[]; nextPageToken?: string }>(u.toString());
    for (const grp of d.searchResults ?? []) for (const c of grp.contents ?? []) if (c.universeId) hits.set(c.universeId, c);
    token = d.nextPageToken ?? "";
    if (!token) break;
  }
  return [...hits.values()];
}

export type GamePass = { id: number; name: string; price: number | null; isForSale: boolean };

export async function getGamePasses(universeId: number): Promise<GamePass[]> {
  const d = await rbx<{ gamePasses?: GamePass[] }>(
    `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=100`,
  );
  return d.gamePasses ?? [];
}

export const playUrl = (placeId: number) => `roblox://experiences/start?placeId=${placeId}`;
export const webUrl = (placeId: number) => `https://www.roblox.com/games/${placeId}`;
