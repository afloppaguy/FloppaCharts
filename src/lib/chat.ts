import Anthropic from "@anthropic-ai/sdk";
import { explainAiError, getBudget, getClient, HAIKU, modelLabel, OPUS, pickModel, recordUsage, SONNET } from "./ai";
import { now, q, run } from "./db";
import { TOOLS } from "./mcp-tools";

// The idea chat: Claude with the dashboard's own tools, so every verdict is
// checked against live data instead of general knowledge.

export const GRADES = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"] as const;
export type Grade = (typeof GRADES)[number];

const CHAT_TOOLS = new Set([
  "list_games", "get_game", "get_game_history", "list_niches", "search_roblox", "query_database", "get_status", "list_notes",
  "add_game", "backfill_history", "set_tags", "set_watch", "save_preset",
]);

// A reply must finish inside the host's 300-second limit, so research stops
// early enough to leave time for writing the answer.
const RESEARCH_SECONDS = 170;
const MAX_TOOL_ROUNDS = 8;

const SYSTEM = `You are the analyst inside Floppa Charts, a private dashboard that tracks thousands of Roblox games over time. You work for one person: a Roblox developer who uses this to find rising games, spot niches before others do, and decide what to build next.

What you are for
- Judging game ideas. When the developer describes an idea, check it against the live data before giving any opinion: search for existing games like it, see how crowded the space is, how the games in it are trending, how old the leaders are, their like ratios, and whether new entrants are getting traction. An idea is only as good as the evidence for it.
- Finding opportunities. Use the niche and rising-game tools to point at specific openings, and name the games that show them.
- Planning. When asked, help turn an idea into a concrete plan: core loop, the first session, what to build first, monetization that fits the genre, and what to measure after launch.

How to work
- Use the tools, but spend them deliberately. You have a few minutes per reply, so plan what you need, ask for several things in one step where you can, and stop researching once you can answer. Around four to six lookups is typical; a greeting or a simple question needs none. When you are told research time is up, write the answer from what you have.
- The dataset is the point; general Roblox knowledge is a fallback and should be labelled as such when you rely on it. Use search_roblox for anything the tracked set may not cover yet.
- Cite what you found: game names with their numbers (players online, growth and the window it is measured over, age, like ratio). The developer should be able to open the games you mention.
- You can search the web (at most three searches per reply). Use it for what the dataset cannot know: trends outside Roblox that games ride on (memes, shows, YouTube and TikTok formats), news about Roblox itself, or background on a genre. Do not use it for Roblox player counts; the dataset is more current. Say when a point comes from the web and name the source.
- Growth figures depend on how much history exists. Each game reports the window its growth is measured over ("24h", "1h", or "since tracked"). Say which one you are quoting, and do not treat a short window as a trend.
- Two signals work even with little history. Pace is a game's visit rate right now against its lifetime average; above 1.5 means it is accelerating. Estimated session length is players online divided by visits per minute; it is an estimate, good for comparing games and not an exact figure.
- Be blunt. If an idea is crowded, late, or weak, say so plainly and say why. Do not soften a low grade, and do not inflate a grade to be encouraging.
- You cannot play or see inside any game. You know a game only through its stats, title, description, game passes, and the developer's own playtest notes. Do not describe gameplay you have not been told about.

Grading
- Every time you assess an idea (a first verdict, or a revised one after the idea changes), call record_grade so the grade shows on the idea's page, then discuss it in your reply.
- The scale, worst to best: F, E, D, C, B, A, S, SS, SSS. Grade the idea as described, for a solo developer or small team, on demand (are players showing up for this), competition (how many games, how entrenched), timing (rising, peaked, fading), and buildability (scope a small team can ship).
  F: no realistic path.
  E, D: serious problems; the evidence is against it.
  C: workable but unremarkable; expect a small audience.
  B: solid; real evidence of demand and room to enter.
  A: the realistic ceiling for an idea you can support with data: strong demand, a clear gap, well suited to a small team. Most good ideas top out here, and A is high praise.
  S: could plausibly become one of the biggest games on the platform for a season. Needs extraordinary evidence, not just a rising niche.
  SS: would define or redefine a genre and sit among the very top games for years.
  SSS: a once-in-years phenomenon that changes what Roblox is, on the scale of the largest games the platform has ever had.
- S, SS and SSS are almost never correct. Hits at that level come from execution, timing and luck that no dataset shows in advance, so you cannot honestly predict one from an idea. Do not award them because an idea is exciting, because a niche is hot, or because you were asked to. If the developer asks for an "SSS idea", say plainly that nobody can promise that, give the strongest idea the evidence supports, and grade it honestly. Across hundreds of ideas you should expect to give an S or above perhaps once, if ever.

Writing
- Lead with the verdict, then the evidence, then what would change your mind. Short paragraphs; a small table only when comparing several games on the same few numbers, with short cells.
- Show the games, do not only name them. Right after a paragraph or list that cites tracked games as evidence, add a line on its own in exactly this form: ::games 123456, 234567, 345678 (the games' universe IDs, up to 8). The dashboard turns that line into a row of game cards with icons and live numbers that the developer can click. Use it for comparisons, competitors, and examples of a niche; one or two rows per reply is plenty. Never put anything else on that line.
- When you grade an idea, give the game a real title in record_grade (the way it would appear on Roblox) and a one-sentence pitch, and refer to the idea by that title in your reply.
- Write for a person, in plain words. Never show internal field or tool names such as pace_vs_lifetime, est_session_minutes, rise_score, universe_id or list_games: say "pace", "estimated session length", "growth". Give numbers the way a person would read them ("12.4K players", "pace 2.3x").
- No filler, no pep talk, and no description of your own process ("I'll start by checking...").`;

const GRADE_TOOL: Anthropic.Beta.BetaTool = {
  name: "record_grade",
  description: "Record your grade for the idea under discussion so it shows on the idea's page. Call this every time you give or revise a verdict on an idea. S, SS and SSS are reserved for platform-defining potential and are almost never correct.",
  input_schema: {
    type: "object",
    properties: {
      grade: { type: "string", enum: [...GRADES] },
      reason: { type: "string", description: "One or two sentences: the main evidence behind the grade." },
      name: { type: "string", description: "A name for the game itself, written the way a Roblox game title would be (2-5 words, e.g. 'Feed and Raid'). Use the developer's own name for it if they gave one." },
      pitch: { type: "string", description: "The idea in one plain sentence: what the player does and why it is fun. At most 25 words." },
    },
    required: ["grade", "reason", "name", "pitch"],
  },
};

function tools(model: string): Anthropic.Beta.BetaToolUnion[] {
  const own: Anthropic.Beta.BetaTool[] = TOOLS.filter((t) => CHAT_TOOLS.has(t.name)).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool["input_schema"] }));
  // Web search runs on Anthropic's side and is billed per search, so it is capped per reply.
  const web: Anthropic.Beta.BetaToolUnion = model === HAIKU ? { type: "web_search_20250305", name: "web_search", max_uses: 3 } : { type: "web_search_20260209", name: "web_search", max_uses: 3 };
  return [...own, GRADE_TOOL, web];
}

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "grade"; grade: string; reason: string; name: string | null; pitch: string | null }
  | { type: "usage"; cost: number; tokens: number }
  | { type: "done"; model: string; cost: number; chatCost: number; remaining: number; seconds: number }
  | { type: "error"; message: string };

export async function createChat(firstMessage: string): Promise<number> {
  const t = now();
  const title = firstMessage.replace(/\s+/g, " ").trim().slice(0, 70) || "New idea";
  const r = await run("INSERT INTO chats (title, created_at, updated_at) VALUES (?, ?, ?)", [title, t, t]);
  return Number(r.lastInsertRowid);
}

type Block = { type: string; id?: string; tool_use_id?: string; text?: string; name?: string; input?: Record<string, unknown> };
type Stored = { role: "user" | "assistant"; content: string | Block[] };

/**
 * A turn can be cut off (a timeout, a closed tab) after Claude asked for tools
 * but before their results were saved. The API rejects such a history, so any
 * tool request without a result gets a placeholder result here.
 */
export function repairHistory(messages: Stored[]): Stored[] {
  // Results can also end up out of place (two requests writing to one
  // conversation at once), so the history is rebuilt: every result is lifted
  // out, and each tool request is followed directly by its own results.
  const results = new Map<string, Block>();
  for (const m of messages) {
    if (m.role === "user" && typeof m.content !== "string") for (const b of m.content) if (b.type === "tool_result" && b.tool_use_id && !results.has(b.tool_use_id)) results.set(b.tool_use_id, b);
  }
  const out: Stored[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push(m);
      continue;
    }
    if (m.role === "user") {
      const rest = m.content.filter((b) => b.type !== "tool_result");
      if (rest.length) out.push({ role: "user", content: rest });
      continue;
    }
    if (!m.content.length) continue;
    out.push(m);
    const asked = m.content.filter((b) => b.type === "tool_use" && b.id).map((b) => b.id as string);
    if (asked.length) {
      out.push({
        role: "user",
        content: asked.map((id) => results.get(id) ?? ({ type: "tool_result", tool_use_id: id, is_error: true, content: "This lookup was interrupted before it finished." } as Block)),
      });
    }
  }
  return out;
}

async function loadMessages(chatId: number): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await q<{ role: string; content: string }>("SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY seq", [chatId]);
  const stored: Stored[] = rows.map((r) => ({ role: r.role === "user" ? "user" : "assistant", content: JSON.parse(r.content) }));
  return repairHistory(stored) as unknown as Anthropic.Beta.BetaMessageParam[];
}

async function append(chatId: number, role: "user" | "assistant", content: unknown) {
  await run(
    "INSERT INTO chat_messages (chat_id, seq, role, content) VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_messages WHERE chat_id = ?), ?, ?)",
    [chatId, chatId, role, JSON.stringify(content)],
  );
}

const describe = (name: string, input: Record<string, unknown>) => {
  const v = (k: string) => (input[k] != null && typeof input[k] !== "object" ? String(input[k]).slice(0, 40) : "");
  switch (name) {
    case "search_roblox":
      return `Searching Roblox for "${v("query")}"`;
    case "list_games":
      return `Looking through games${v("q") ? ` matching "${v("q")}"` : v("sub") ? ` in ${v("sub")}` : v("genre") ? ` in ${v("genre")}` : v("chart") ? ` on ${v("chart").replace(/-/g, " ")}` : ""}${v("sort") ? `, by ${v("sort")}` : ""}`;
    case "list_niches":
      return "Checking which niches are hot";
    case "get_game":
      return "Opening a game";
    case "get_game_history":
      return "Reading a game's history";
    case "query_database":
      return "Running a custom query";
    case "list_notes":
      return "Reading your playtest notes";
    case "get_status":
      return "Checking the dataset";
    case "add_game":
      return "Adding a game to tracking";
    case "backfill_history":
      return "Fetching older history";
    case "set_tags":
      return "Tagging a game";
    case "set_watch":
      return "Updating your watchlist";
    case "save_preset":
      return `Saving preset "${v("name")}"`;
    default:
      return name;
  }
};

/** One-line summary of the conversation for the Ideas list. Always Haiku; costs a fraction of a cent. */
async function summarize(client: Anthropic, chatId: number, userText: string, reply: string) {
  try {
    const res = await client.messages.create({
      model: HAIKU,
      max_tokens: 200,
      output_config: { effort: "low" },
      system: "You write one-line summaries of conversations between a Roblox developer and a market analyst, for a list of saved conversations. Reply with the summary only: one sentence, at most 22 words, saying what was asked and the conclusion reached. No quotation marks, no preamble.",
      messages: [{ role: "user", content: `Developer asked:\n${userText.slice(0, 1500)}\n\nAnalyst concluded:\n${reply.slice(0, 4000)}` }],
    });
    await recordUsage("summary", HAIKU, res.usage);
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ").trim();
    if (text) await run("UPDATE chats SET summary = ? WHERE id = ?", [text.slice(0, 240), chatId]);
  } catch {
    // a missing summary is not worth failing the turn over
  }
}

/** Run one user turn to completion, emitting events as the reply streams. */
export async function runChatTurn(chatId: number, userText: string, emit: (e: ChatEvent) => void, requestedModel?: string | null) {
  const started = Date.now();
  let cost = 0;
  let model = HAIKU;
  let locked = false;
  try {
    const busy = await q<{ busy_until: number }>("SELECT busy_until FROM chats WHERE id = ?", [chatId]);
    if (busy[0] && Number(busy[0].busy_until) > now()) {
      emit({ type: "error", message: "The previous reply in this conversation is still being written. Give it a moment, then try again." });
      return;
    }
    const client = await getClient();
    model = await pickModel(requestedModel);
    await run("UPDATE chats SET busy_until = ?, model = ? WHERE id = ?", [now() + 320, model, chatId]);
    locked = true;

    const messages = await loadMessages(chatId);
    messages.push({ role: "user", content: userText });
    await append(chatId, "user", userText);

    let replyText = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS + 2; round++) {
      const outOfTime = (Date.now() - started) / 1000 > RESEARCH_SECONDS || round >= MAX_TOOL_ROUNDS;
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: tools(model),
        // Once research time is up, Claude must answer from what it has gathered.
        ...(outOfTime ? { tool_choice: { type: "none" as const } } : {}),
        messages: outOfTime ? [...messages, { role: "user" as const, content: "Research time for this reply is up. Write your full answer now from what you have gathered; do not ask for more lookups." }] : messages,
        output_config: { effort: "medium" },
        // If a safety filter declines a request, the API retries it on its default fallback model.
        ...(model === SONNET || model === OPUS ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      stream.on("text", (delta) => emit({ type: "text", delta }));
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "server_tool_use" && event.content_block.name === "web_search") {
          emit({ type: "tool", name: "web_search", summary: "Searching the web" });
        }
      });
      const message = await stream.finalMessage();
      const stepCost = await recordUsage("chat", model, message.usage);
      cost += stepCost;
      emit({ type: "usage", cost, tokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0) + message.usage.output_tokens });

      if (message.stop_reason === "refusal") {
        emit({ type: "error", message: "Claude declined to answer that request." });
        break;
      }
      replyText += message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
      if (outOfTime) {
        // Stored without the hidden "time is up" nudge so the saved history stays as the user saw it.
        const kept = message.content.filter((b) => b.type !== "tool_use");
        if (kept.length) await append(chatId, "assistant", kept);
        break;
      }
      messages.push({ role: "assistant", content: message.content });
      await append(chatId, "assistant", message.content);
      if (message.stop_reason === "pause_turn") continue;

      const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (!calls.length) break;
      if (message.stop_reason === "max_tokens") {
        emit({ type: "error", message: "The reply was cut off before a lookup finished. Ask again, perhaps more narrowly." });
        break;
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
        calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const input = (call.input ?? {}) as Record<string, unknown>;
          try {
            if (call.name === "record_grade") {
              const grade = String(input.grade);
              if (!(GRADES as readonly string[]).includes(grade)) throw new Error(`grade must be one of ${GRADES.join(", ")}`);
              const reason = String(input.reason ?? "");
              const name = input.name ? String(input.name).slice(0, 60) : null;
              const pitch = input.pitch ? String(input.pitch).slice(0, 240) : null;
              await run("UPDATE chats SET grade = ?, grade_reason = ?, title = COALESCE(?, title), idea_name = COALESCE(?, idea_name), pitch = COALESCE(?, pitch) WHERE id = ?", [grade, reason, name, name, pitch, chatId]);
              emit({ type: "grade", grade, reason, name, pitch });
              return { type: "tool_result", tool_use_id: call.id, content: "Recorded." };
            }
            const tool = TOOLS.find((t) => t.name === call.name && CHAT_TOOLS.has(t.name));
            if (!tool) throw new Error(`Unknown tool ${call.name}`);
            emit({ type: "tool", name: call.name, summary: describe(call.name, input) });
            // No single lookup may eat the whole reply.
            const out = await Promise.race([tool.run(input), new Promise((_, reject) => setTimeout(() => reject(new Error("This lookup took too long and was stopped.")), 45_000))]);
            return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out, (_, v) => (typeof v === "bigint" ? Number(v) : v)).slice(0, 40_000) };
          } catch (e) {
            return { type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      messages.push({ role: "user", content: results });
      await append(chatId, "user", results);
    }

    await run("UPDATE chats SET updated_at = ?, cost_usd = cost_usd + ? WHERE id = ?", [now(), cost, chatId]);
    if (replyText.trim()) await summarize(client, chatId, userText, replyText);
    const [budget, chat] = await Promise.all([getBudget(), q<{ cost_usd: number }>("SELECT cost_usd FROM chats WHERE id = ?", [chatId])]);
    emit({ type: "done", model: modelLabel(model), cost, chatCost: Number(chat[0]?.cost_usd ?? cost), remaining: budget.remaining, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    emit({ type: "error", message: explainAiError(e) });
  } finally {
    if (locked) await run("UPDATE chats SET busy_until = 0 WHERE id = ?", [chatId]).catch(() => {});
  }
}

export type IdeaCard = { grade: string; name: string | null; pitch: string | null };
export type ChatTurn = { role: "user" | "assistant"; text: string; tools: string[]; card?: IdeaCard };

/** Stored messages flattened for display: text plus the names of tools used. */
export async function getChatTurns(chatId: number): Promise<ChatTurn[]> {
  const rows = await q<{ role: string; content: string }>("SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY seq", [chatId]);
  const turns: ChatTurn[] = [];
  for (const r of rows) {
    const content = JSON.parse(r.content) as string | Block[];
    if (typeof content === "string") {
      turns.push({ role: r.role === "user" ? "user" : "assistant", text: content, tools: [] });
      continue;
    }
    if (r.role === "user") continue; // tool results
    const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const used = content.filter((b) => b.type === "tool_use" && b.name !== "record_grade").map((b) => b.name ?? "");
    const graded = content.find((b) => b.type === "tool_use" && b.name === "record_grade")?.input;
    const card: IdeaCard | undefined = graded?.grade ? { grade: String(graded.grade), name: graded.name ? String(graded.name) : null, pitch: graded.pitch ? String(graded.pitch) : null } : undefined;
    const last = turns[turns.length - 1];
    if (last?.role === "assistant") {
      last.text += (last.text && text ? "\n\n" : "") + text;
      last.tools.push(...used);
      if (card) last.card = card;
    } else turns.push({ role: "assistant", text, tools: used, card });
  }
  return turns;
}

export type ChatRow = { id: number; title: string; grade: string | null; grade_reason: string | null; summary: string | null; idea_name: string | null; pitch: string | null; cost_usd: number; model: string | null; updated_at: number; messages: number };

const CHAT_COLS = `c.id, c.title, c.grade, c.grade_reason, c.summary, c.idea_name, c.pitch, c.cost_usd, c.model, c.updated_at,
  (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id AND m.role = 'user' AND m.content LIKE '"%') AS messages`;

export async function listChats() {
  return q<ChatRow>(`SELECT ${CHAT_COLS} FROM chats c ORDER BY c.updated_at DESC LIMIT 200`);
}

export async function getChat(id: number) {
  const r = await q<ChatRow>(`SELECT ${CHAT_COLS} FROM chats c WHERE c.id = ?`, [id]);
  return r[0] ?? null;
}

export async function deleteChat(id: number) {
  await run("DELETE FROM chat_messages WHERE chat_id = ?", [id]);
  await run("DELETE FROM chats WHERE id = ?", [id]);
}
