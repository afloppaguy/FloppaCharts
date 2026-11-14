"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { explainAiError, getAiSettings, getBudget, setAiSettings, setChosenModel, type AiSettings } from "@/lib/ai";
import { analyzeGame, getMyGame } from "@/lib/analytics";
import { deleteChat } from "@/lib/chat";
import { findGaps, generateBriefing } from "@/lib/insights";
import { kvSet, now, q, run } from "@/lib/db";
import * as ops from "@/lib/ops";
import { universeName } from "@/lib/roblox";
import { encryptSecret, hashPassword, rateLimit, safeEqual, verifyPassword } from "@/lib/security";
import { scoped, uidNow } from "@/lib/scope";
import { requireOwner } from "@/lib/session";
import { forgetMember } from "@/proxy";
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
  if (key && key.length <= 400) await kvSet(scoped("anthropic_key", await uidNow()), encryptSecret(key));
  revalidatePath("/settings");
}

export async function removeClaudeKey() {
  await run("DELETE FROM kv WHERE key = ?", [scoped("anthropic_key", await uidNow())]);
  revalidatePath("/settings");
}

export async function saveBudget(formData: FormData) {
  const n = (k: string, d: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  const budget = n("monthlyBudget", 100);
  const patch: Partial<AiSettings> = { monthlyBudget: budget };
  // "Left right now" lets the user correct for credits spent outside this app.
  const remaining = String(formData.get("remaining") ?? "").trim();
  if (remaining !== "" && Number.isFinite(Number(remaining))) {
    const [current, spentNow] = await Promise.all([getAiSettings(), getBudget().then((b) => b.spent)]);
    patch.adjustment = current.adjustment + (budget - Number(remaining) - spentNow);
  }
  await setAiSettings(patch);
  revalidatePath("/settings");
}

/** At most 40 AI actions an hour (tagging, checks, gap finder, briefing), on top of the monthly budget. */
async function aiGate() {
  const r = await rateLimit(`ai-actions:${await uidNow()}`, 40, 3600);
  if (!r.ok) throw new Error(`AI action limit reached (40 an hour). Try again in ${Math.ceil(r.retryAfter / 60)} minutes.`);
}

// ---- AI tagging ----

export async function tagGameAction(id: number): Promise<Result> {
  try {
    await aiGate();
    const r = await tagGames([id], "ai");
    revalidatePath(`/games/${id}`);
    return { ok: true, message: r.tagged ? "Tagged" : "The description was too vague to tag" };
  } catch (e) {
    return { ok: false, message: explainAiError(e) };
  }
}

export async function tagRisingAction(): Promise<Result> {
  try {
    await aiGate();
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
    const uid = await uidNow();
    const universeId = await ops.resolveUniverse(ref);
    let keyId = existing;
    if (apiKey) {
      const r = await run("INSERT INTO rbx_keys (label, api_key, created_at, owner_id) VALUES (?, ?, ?, ?)", [label.slice(0, 60), encryptSecret(apiKey), now(), uid]);
      keyId = Number(r.lastInsertRowid);
    } else if (!(await q("SELECT 1 FROM rbx_keys WHERE id = ? AND owner_id = ?", [keyId, uid])).length) {
      throw new Error("That key is not one of yours. Add it in Settings first.");
    }
    const taken = await q<{ owner_id: number }>("SELECT owner_id FROM my_games WHERE universe_id = ?", [universeId]);
    if (taken[0] && Number(taken[0].owner_id) !== uid) throw new Error("Someone else on this dashboard has already connected that game.");
    let name = `Game ${universeId}`;
    try {
      await ops.addGame(String(universeId), "you");
      const g = await q<{ name: string }>("SELECT name FROM games WHERE universe_id = ?", [universeId]);
      if (g[0]?.name) name = g[0].name;
    } catch {
      // A private or unreleased game has no public page; analytics still work.
    }
    if (/^Game \d+$/.test(name)) name = (await universeName(universeId)) ?? name;
    await run(
      "INSERT INTO my_games (universe_id, key_id, name, added_at, owner_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(universe_id) DO UPDATE SET key_id = excluded.key_id, name = excluded.name",
      [universeId, keyId, name, now(), uid],
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/my-games");
  redirect(error ? `/my-games?error=${encodeURIComponent(error)}` : "/my-games");
}

export async function removeMyGame(formData: FormData) {
  const id = Number(formData.get("id"));
  const gone = await run("DELETE FROM my_games WHERE universe_id = ? AND owner_id = ?", [id, await uidNow()]);
  if (gone.rowsAffected) await run("DELETE FROM metric_cache WHERE universe_id = ?", [id]);
  revalidatePath("/my-games");
  redirect("/my-games");
}

export async function refreshMyGame(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!(await getMyGame(id))) return; // not one of your games
  await run("DELETE FROM metric_cache WHERE universe_id = ?", [id]);
  revalidatePath(`/my-games/${id}`);
}

export async function runAnalysis(id: number): Promise<Result> {
  try {
    await aiGate();
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
  if (!(await getMyGame(game))) return; // not one of your games
  await run("UPDATE findings SET dismissed = 1 WHERE id = ? AND universe_id = ?", [id, game]);
  revalidatePath(`/my-games/${game}`);
}

// ---- Roblox API keys (managed in Settings) ----

export async function addRobloxKey(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim().slice(0, 60) || "My key";
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (apiKey && apiKey.length <= 2000) await run("INSERT INTO rbx_keys (label, api_key, created_at, owner_id) VALUES (?, ?, ?, ?)", [label, encryptSecret(apiKey), now(), await uidNow()]);
  revalidatePath("/settings");
  revalidatePath("/my-games");
}

/** Deleting a key also disconnects the games that were using it. */
export async function deleteRobloxKey(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  if (!(await q("SELECT 1 FROM rbx_keys WHERE id = ? AND owner_id = ?", [id, await uidNow()])).length) return; // not yours
  const games = await q<{ universe_id: number }>("SELECT universe_id FROM my_games WHERE key_id = ?", [id]);
  for (const g of games) await run("DELETE FROM metric_cache WHERE universe_id = ?", [Number(g.universe_id)]);
  await run("DELETE FROM my_games WHERE key_id = ?", [id]);
  await run("DELETE FROM rbx_keys WHERE id = ?", [id]);
  revalidatePath("/settings");
  revalidatePath("/my-games");
}

// ---- Ideas ----

export async function deleteChatAction(formData: FormData) {
  await deleteChat(Number(formData.get("id")));
  revalidatePath("/ideas");
  redirect("/ideas");
}

export async function setModelAction(id: string) {
  await setChosenModel(id);
  revalidatePath("/settings");
}

// ---- Briefing, gap finder, auto-tagging ----

export async function refreshBriefing(): Promise<Result> {
  try {
    await aiGate();
    await generateBriefing();
    revalidatePath("/");
    return { ok: true, message: "Briefing updated" };
  } catch (e) {
    return { ok: false, message: explainAiError(e) };
  }
}

export async function runGapFinder(): Promise<Result> {
  try {
    await aiGate();
    const r = await findGaps();
    revalidatePath("/gaps");
    return { ok: true, message: `Found ${r.gaps} gaps ($${r.cost.toFixed(3)})` };
  } catch (e) {
    return { ok: false, message: explainAiError(e) };
  }
}

export async function setAutoTagAction(on: boolean) {
  await kvSet(scoped("auto_tag", await uidNow()), on ? "on" : "off");
  revalidatePath("/settings");
}

// ---- People (owner only) ----

export async function addMember(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  const password = String(formData.get("password") ?? "");
  let error = "";
  try {
    await requireOwner();
    if (!name) throw new Error("Give the person a name.");
    if (password.length < 8 || password.length > 200) throw new Error("The password needs at least 8 characters.");
    if (process.env.DASH_PASSWORD && safeEqual(password, process.env.DASH_PASSWORD)) throw new Error("That is your own password. Give them a different one.");
    const members = await q<{ pass_hash: string }>("SELECT pass_hash FROM members");
    if (members.some((m) => verifyPassword(password, m.pass_hash))) throw new Error("Someone already has that password. Each person needs their own.");
    await run("INSERT INTO members (name, pass_hash, created_at) VALUES (?, ?, ?)", [name, hashPassword(password), now()]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/settings");
  redirect(error ? `/settings?error=${encodeURIComponent(error)}#people` : "/settings#people");
}

/** Removing a person signs them out everywhere within half a minute. */
export async function removeMember(formData: FormData) {
  await requireOwner();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await run("DELETE FROM members WHERE id = ?", [id]);
  forgetMember(id);
  revalidatePath("/settings");
}

export async function logoutAction() {
  (await cookies()).delete("radar_session");
  redirect("/login");
}

// ---- Compare ----

export async function addToCompare(formData: FormData) {
  const ids = String(formData.get("ids") ?? "").split(",").filter(Boolean);
  const ref = String(formData.get("ref") ?? "").trim();
  let error = "";
  try {
    let id: number | null = null;
    if (/^\d+$/.test(ref) || /roblox\.com/i.test(ref)) {
      id = await ops.resolveUniverse(ref);
      const known = await q("SELECT 1 FROM games WHERE universe_id = ?", [id]);
      if (!known.length) id = await ops.addGame(ref, "you");
    } else {
      const hit = await q<{ universe_id: number }>("SELECT universe_id FROM games WHERE name LIKE ? ORDER BY playing DESC LIMIT 1", [`%${ref}%`]);
      if (!hit[0]) throw new Error(`No tracked game matches "${ref}". Paste its Roblox link to add it.`);
      id = Number(hit[0].universe_id);
    }
    if (!ids.includes(String(id))) ids.push(String(id));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  redirect(`/compare?ids=${ids.join(",")}${error ? `&error=${encodeURIComponent(error)}` : ""}`);
}
