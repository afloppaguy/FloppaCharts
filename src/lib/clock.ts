// Every timestamp in the database must be real time, because the collector
// runs on several machines (GitHub's servers, Vercel, a home PC) and a PC's
// clock can be hours off. On start-up the app asks a Roblox server what time
// it is and, if the local clock disagrees by more than 90 seconds, corrects
// for the difference from then on.

const g = globalThis as unknown as { __clockOffsetMs?: number; __clockSync?: Promise<void> };

export const nowMs = () => Date.now() + (g.__clockOffsetMs ?? 0);
export const clockOffsetSeconds = () => Math.round((g.__clockOffsetMs ?? 0) / 1000);

async function serverTime(url: string): Promise<number | null> {
  try {
    const sent = Date.now();
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    const remote = Date.parse(res.headers.get("date") ?? "");
    return Number.isFinite(remote) ? remote - (sent + Date.now()) / 2 : null;
  } catch {
    return null;
  }
}

export function syncClock(): Promise<void> {
  if (!g.__clockSync) {
    g.__clockSync = (async () => {
      const diff = (await serverTime("https://apis.roblox.com/")) ?? (await serverTime("https://api.github.com/"));
      g.__clockOffsetMs = diff != null && Math.abs(diff) > 90_000 ? Math.round(diff) : 0;
      if (g.__clockOffsetMs) console.warn(`This machine's clock is off by ${Math.round(g.__clockOffsetMs / 1000)}s; correcting timestamps.`);
    })();
  }
  return g.__clockSync;
}
