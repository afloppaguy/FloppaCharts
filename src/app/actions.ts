"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { explainAiError, getAiSettings, getBudget, setAiSettings, type AiSettings } from "@/lib/ai";
import { analyzeGame } from "@/lib/analytics";
import { deleteChat } from "@/lib/chat";
import { kvSet, now, q, run } from "@/lib/db";
import * as ops from "@/lib/ops";
import { tagGames, untaggedRising } from "@/lib/tagging";

type Result = { ok: true; message?: string } | { ok: false; message: string };
const fail = (e: unknown): Result => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export async function toggleWatch(id: number, on: boolean): Promise<Result> {
  try {
    await ops.setWatch(id, on, "you");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveNote(id: number, body: string): Promise<Result> {
  try {
    await ops.setNote(id, body, "you");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function backfill(id: number): Promise<Result> {
  try {
    const r = await ops.backfillFromRolimons(id, "you");
    revalidatePath(`/games/${id}`);
    return { ok: true, message: `Added ${r.points.toLocaleString("en-US")} history points back to ${new Date(r.from * 1000).toISOString().slice(0, 10)}` };
  } catch (e) {
    return fail(e);
  }
}

export async function addTag(id: number, tag: string): Promise<Result> {
  try {
    await ops.addTags(id, [tag], "you");
    revalidatePath(`/games/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeTag(id: number, tag: string): Promise<Result> {
  try {
    await ops.removeTags(id, [tag], "you");
    revalidatePath(`/games/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addGameAction(formData: FormData) {
  const ref = String(formData.get("ref") ?? "").trim();
  if (!ref) return;
  let id: number;
  try {
    id = await ops.addGame(ref, "you");
  } catch (e) {
    redirect(`/games?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  redirect(`/games/${id}`);
}

export async function markAlertsRead() {
  await run("UPDATE alerts SET read = 1 WHERE read = 0");
  revalidatePath("/", "layout");
}

export async function undoEditAction(formData: FormData) {
  const id = Number(formData.get("id"));
  try {
    await ops.undoEdit(id, "you");
  } catch {
    // shown as still-not-undone on refresh
  }
  revalidatePath("/activity");
}

export async function setView(view: "grid" | "list") {
  (await cookies()).set("radar_view", view, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

// ---- Claude key and budget ----

export async function saveClaudeKey(formData: FormData) {
  const key = String(formData.get("key") ?? "").trim();
  if (key) await kvSet("anthropic_key", key);
  revalidatePath("/settings");
}

export async function removeClaudeKey() {
  await run("DELETE FROM kv WHERE key = 'anthropic_key'");
  revalidatePath("/settings");
}

export async function saveBudget(formData: FormData) {
  const n = (k: string, d: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  const budget = n("monthlyBudget", 100);
  const patch: Partial<AiSettings> = { monthlyBudget: budget, switchBelow: n("switchBelow", 25) };
  // "Left right now" lets the user correct for credits spent outside this app.
  const remaining = String(formData.get("remaining") ?? "").trim();
  if (remaining !== "" && Number.isFinite(Number(remaining))) {
    const [current, spentNow] = await Promise.all([getAiSettings(), getBudget().then((b) => b.spent)]);
    patch.adjustment = current.adjustment + (budget - Number(remaining) - spentNow);
  }
  await setAiSettings(patch);
  revalidatePath("/settings");
}

// ---- AI tagging ----

export async function tagGameAction(id: number): Promise<Result> {
  try {
    const r = await tagGames([id], "ai");
    revalidatePath(`/games/${id}`);
    return { ok: true, message: r.tagged ? "Tagged" : "The description was too vague to tag" };
  } catch (e) {
    return { ok: false, message: explainAiError(e) };
  }
}

export async function tagRisingAction(): Promise<Result> {
  try {
    const ids = await untaggedRising(40);
    if (!ids.length) return { ok: true, message: "Every rising game is already tagged" };
    const r = await tagGames(ids, "ai");
    revalidatePath("/niches");
    return { ok: true, message: `Tagged ${r.tagged} games for $${r.cost.toFixed(4)}` };
  } catch (e) {
    return { ok: false, message: explainAiError(e) };
  }
}

// ---- My games ----

export async function connectMyGame(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim() || "My key";
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const existing = Number(formData.get("keyId") ?? 0);
  const ref = String(formData.get("ref") ?? "").trim();
  let error = "";
  try {
    if (!ref) throw new Error("Paste the game's Roblox link or ID.");
    if (!apiKey && !existing) throw new Error("Paste an API key, or pick one you already added.");
    const universeId = await ops.resolveUniverse(ref);
    let keyId = existing;
    if (apiKey) {
      const r = await run("INSERT INTO rbx_keys (label, api_key, created_at) VALUES (?, ?, ?)", [label, apiKey, now()]);
      keyId = Number(r.lastInsertRowid);
    }
    let name = `Game ${universeId}`;
    try {
      await ops.addGame(String(universeId), "you");
      const g = await q<{ name: string }>("SELECT name FROM games WHERE universe_id = ?", [universeId]);
      if (g[0]?.name) name = g[0].name;
    } catch {
      // A private or unreleased game has no public page; analytics still work.
    }
    await run(
      "INSERT INTO my_games (universe_id, key_id, name, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(universe_id) DO UPDATE SET key_id = excluded.key_id, name = excluded.name",
      [universeId, keyId, name, now()],
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/my-games");
  redirect(error ? `/my-games?error=${encodeURIComponent(error)}` : "/my-games");
}

export async function removeMyGame(formData: FormData) {
  const id = Number(formData.get("id"));
  await run("DELETE FROM my_games WHERE universe_id = ?", [id]);
  await run("DELETE FROM metric_cache WHERE universe_id = ?", [id]);
  await run("DELETE FROM rbx_keys WHERE id NOT IN (SELECT key_id FROM my_games)");
  revalidatePath("/my-games");
  redirect("/my-games");
}

export async function refreshMyGame(formData: FormData) {
  const id = Number(formData.get("id"));
  await run("DELETE FROM metric_cache WHERE universe_id = ?", [id]);
  revalidatePath(`/my-games/${id}`);
}

export async function runAnalysis(id: number): Promise<Result> {
  try {
    const r = await analyzeGame(id);
    revalidatePath(`/my-games/${id}`);
    return { ok: true, message: `${r.findings} findings ($${r.cost.toFixed(3)})` };
  } catch (e) {
    return { ok: false, message: explainAiError(e) };
  }
}

export async function dismissFinding(formData: FormData) {
  const id = Number(formData.get("id"));
  const game = Number(formData.get("game"));
  await run("UPDATE findings SET dismissed = 1 WHERE id = ?", [id]);
  revalidatePath(`/my-games/${game}`);
}

// ---- Ideas ----

export async function deleteChatAction(formData: FormData) {
  await deleteChat(Number(formData.get("id")));
  revalidatePath("/ideas");
  redirect("/ideas");
}
