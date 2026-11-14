import { AsyncLocalStorage } from "node:async_hooks";

// Whose things are these? Each person who signs in has their own Claude key,
// budget, model, Roblox keys, connected games and idea chats. The owner is
// person 0; everyone added under Settings > People has their member number.
//
// Inside a page, route or action the person comes from the session cookie.
// Work that outlives the request (a streamed chat reply, background upkeep)
// is wrapped in runAs() so it keeps acting for the person who started it.

const store = new AsyncLocalStorage<{ uid: number }>();

export function runAs<T>(uid: number, fn: () => Promise<T>): Promise<T> {
  return store.run({ uid }, fn);
}

export async function uidNow(): Promise<number> {
  const explicit = store.getStore();
  if (explicit) return explicit.uid;
  try {
    const { currentUser } = await import("./session");
    return (await currentUser())?.memberId ?? 0;
  } catch {
    return 0; // outside a request (collector, scripts): the owner
  }
}

/** A per-person settings key: the owner keeps the plain name, members get a suffix. */
export const scoped = (name: string, uid: number) => (uid ? `${name}:u${uid}` : name);
