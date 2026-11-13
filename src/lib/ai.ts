import Anthropic from "@anthropic-ai/sdk";
import { kvGet, kvSet, now, q, run } from "./db";

// Claude access for the dashboard: where the key comes from, which model to
// use, and what has been spent this month.

export const SONNET = "claude-sonnet-5-5";
export const HAIKU = "claude-haiku-5-5";

// USD per million tokens. Cache writes are billed at 1.25x input.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  [SONNET]: { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  [HAIKU]: { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export type AiSettings = { monthlyBudget: number; switchBelow: number; adjustment: number };

export async function getAiSettings(): Promise<AiSettings> {
  const raw = await kvGet("ai_settings");
  const s = raw ? (JSON.parse(raw) as Partial<AiSettings>) : {};
  return { monthlyBudget: s.monthlyBudget ?? 100, switchBelow: s.switchBelow ?? 25, adjustment: s.adjustment ?? 0 };
}

export async function setAiSettings(patch: Partial<AiSettings>) {
  await kvSet("ai_settings", JSON.stringify({ ...(await getAiSettings()), ...patch }));
}

/** The key from the environment wins; otherwise the one saved in Settings. */
export async function getApiKey(): Promise<{ key: string; source: "env" | "settings" } | null> {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "env" };
  const saved = await kvGet("anthropic_key");
  return saved ? { key: saved, source: "settings" } : null;
}

export class NoKeyError extends Error {
  constructor() {
    super("No Claude API key is set. Add one in Settings.");
  }
}

export async function getClient(): Promise<Anthropic> {
  const k = await getApiKey();
  if (!k) throw new NoKeyError();
  return new Anthropic({ apiKey: k.key });
}

const monthStart = () => {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
};

export async function getBudget() {
  const [settings, rows] = await Promise.all([
    getAiSettings(),
    q<{ spent: number | null; calls: number }>("SELECT SUM(cost_usd) AS spent, COUNT(*) AS calls FROM ai_usage WHERE ts >= ?", [monthStart()]),
  ]);
  // `adjustment` lets the user account for credits spent outside this app.
  const spent = Number(rows[0].spent ?? 0) + settings.adjustment;
  const remaining = Math.max(settings.monthlyBudget - spent, 0);
  return { ...settings, spent, remaining, calls: Number(rows[0].calls), model: remaining <= settings.switchBelow ? HAIKU : SONNET, exhausted: remaining <= 0 };
}

/** Sonnet 5.5 while the month's budget is healthy, Haiku 5.5 once it runs low. */
export async function pickModel(): Promise<string> {
  const b = await getBudget();
  if (b.exhausted) throw new Error(`This month's AI budget ($${b.monthlyBudget}) is used up. Raise it or correct the balance in Settings.`);
  return b.model;
}

type Usage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };

export function costOf(model: string, u: Usage): number {
  const p = PRICES[model] ?? PRICES[SONNET];
  return (u.input_tokens * p.input + (u.cache_creation_input_tokens ?? 0) * p.input * 1.25 + (u.cache_read_input_tokens ?? 0) * p.cacheRead + u.output_tokens * p.output) / 1e6;
}

export async function recordUsage(purpose: string, model: string, u: Usage): Promise<number> {
  const cost = costOf(model, u);
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  await run("INSERT INTO ai_usage (ts, purpose, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)", [now(), purpose, model, input, u.output_tokens, cost]);
  return cost;
}

/** Turn SDK errors into a sentence a person can act on. */
export function explainAiError(e: unknown): string {
  if (e instanceof NoKeyError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key is not allowed to use that model.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate-limiting this key right now. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach Claude. Check the connection and try again.";
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
