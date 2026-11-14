import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { now, q, run } from "./db";

// Rate limiting and secret handling for the dashboard's server side.

/** The caller's address as reported by the host (Vercel sets these; they cannot be forged from outside it). */
export function clientIp(headers: Headers): string {
  return (headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim().slice(0, 64) || "local";
}

/** Compare two strings without leaking, through timing, how much of them matched. */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * Durable rate limit, stored in the database so it holds across every server
 * instance. Counts one attempt and reports whether the caller is still within
 * `limit` attempts per `windowSec`. Use for things worth a database write:
 * logins, wrong tokens, AI calls.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter: number }> {
  const t = now();
  await run(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END`,
    [key, t, t - windowSec, t - windowSec, t],
  );
  const r = await q<{ window_start: number; count: number }>("SELECT window_start, count FROM rate_limits WHERE key = ?", [key]);
  const count = Number(r[0]?.count ?? 1);
  return { ok: count <= limit, retryAfter: Math.max(1, Number(r[0]?.window_start ?? t) + windowSec - t) };
}

/** How many attempts a key has used in its current window, without counting a new one. */
export async function rateCount(key: string, windowSec: number): Promise<number> {
  const r = await q<{ window_start: number; count: number }>("SELECT window_start, count FROM rate_limits WHERE key = ?", [key]);
  return r[0] && Number(r[0].window_start) > now() - windowSec ? Number(r[0].count) : 0;
}

export async function rateReset(key: string) {
  await run("DELETE FROM rate_limits WHERE key = ?", [key]);
}

/**
 * Cheap in-memory rate limit for high-frequency endpoints (search-as-you-type,
 * game cards). Per server instance, so it is a brake on abuse, not an exact quota.
 */
const buckets = new Map<string, { start: number; count: number }>();
export function memoryLimit(key: string, limit: number, windowSec: number): boolean {
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || t - b.start > windowSec * 1000) {
    if (buckets.size > 5000) buckets.clear();
    buckets.set(key, { start: t, count: 1 });
    return true;
  }
  b.count++;
  return b.count <= limit;
}

export function tooMany(retryAfter: number, message = "Too many requests. Slow down and try again shortly.") {
  return Response.json({ error: message }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
}

// ---- Secrets at rest ----
//
// API keys saved in Settings (Claude) and My games (Roblox) are encrypted
// before they are stored, with a key derived from the server's own
// environment. Someone who obtains a copy of the database alone cannot read
// them. Older plain values are still readable and are re-saved encrypted the
// next time they are written.

const PREFIX = "enc:v1:";

function secretKey(): Buffer | null {
  const material = process.env.SECRETS_KEY || process.env.TURSO_AUTH_TOKEN || process.env.DASH_PASSWORD;
  return material ? createHash("sha256").update(`floppa-secrets:${material}`).digest() : null;
}

export function encryptSecret(plain: string): string {
  const key = secretKey();
  if (!key) return plain; // nothing to derive a key from (a bare local setup)
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = secretKey();
  if (!key) throw new Error("A saved API key is encrypted but this server has no key to read it with.");
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("A saved API key could not be read (it was saved under different server settings). Save it again.");
  }
}

/** Tables an AI's read-only SQL may never touch: they hold secrets or security state. */
const SECRET_TABLES = /\b(kv|rbx_keys|rate_limits|sqlite_master|sqlite_schema|sqlite_temp_master)\b/i;
export function assertSafeQuery(sql: string) {
  if (SECRET_TABLES.test(sql)) throw new Error("That table is off limits: it holds keys or security settings. Query games, snapshots, tags, notes, watchlist, presets, alerts or edit_log.");
  if (/\bpragma\b|\battach\b|\bload_extension\b/i.test(sql)) throw new Error("That statement is not allowed.");
}

// ---- Passwords for additional people ----
//
// The owner signs in with DASH_PASSWORD. Anyone else gets their own password,
// stored only as a salted scrypt hash, so it can be removed without touching
// the owner's and is never readable from the database.

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
