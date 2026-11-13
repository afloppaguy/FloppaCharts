import Anthropic from "@anthropic-ai/sdk";
import { explainAiError, getClient, pickModel, recordUsage, SONNET } from "./ai";
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

const SYSTEM = `You are the analyst inside Floppa Charts, a private dashboard that tracks thousands of Roblox games over time. You work for one person: a Roblox developer who uses this to find rising games, spot niches before others do, and decide what to build next.

What you are for
- Judging game ideas. When the developer describes an idea, check it against the live data before giving any opinion: search for existing games like it, see how crowded the space is, how the games in it are trending, how old the leaders are, their like ratios, and whether new entrants are getting traction. An idea is only as good as the evidence for it.
- Finding opportunities. Use the niche and rising-game tools to point at specific openings, and name the games that show them.
- Planning. When asked, help turn an idea into a concrete plan: core loop, the first session, what to build first, monetization that fits the genre, and what to measure after launch.

How to work
- Use the tools. The dataset is the whole point; general Roblox knowledge is a fallback and should be labelled as such when you rely on it. Page through results when a first page is not enough, and use search_roblox for anything the tracked set may not cover yet.
- Cite what you found: game names with their numbers (concurrent players, growth and its window, age, like ratio). The developer should be able to open the games you mention.
- Growth figures depend on how much history exists. Each game reports the window its growth is measured over ("24h", "1h", or "since tracked"). Say which one you are quoting, and do not treat a short window as a trend.
- Two signals work even with little history: pace_vs_lifetime (visit rate now against the game's lifetime average; above 1.5 means it is accelerating) and est_session_minutes (players online divided by visits per minute; an estimate, useful for comparing games, not an exact figure).
- Be blunt. If an idea is crowded, late, or weak, say so plainly and say why. Do not soften a low grade, and do not inflate a grade to be encouraging.
- You cannot play or see inside any game. You know a game only through its stats, title, description, game passes, and the developer's own playtest notes. Do not describe gameplay you have not been told about.

Grading
- Every time you assess an idea (a first verdict, or a revised one after the idea changes), call record_grade so the grade shows on the idea's page, then discuss it in your reply.
- The scale, worst to best: F, E, D, C, B, A, S, SS, SSS.
  F: no realistic path. D-E: serious problems; the evidence is against it. C: workable but unremarkable; expect a small audience. B: solid, with evidence of demand and room to enter. A: strong demand, clear gap, well-suited to a small team. S: a rare opening with rising demand and little competition. SS and SSS are for exceptional cases where the data shows a fast-growing niche with almost nobody serving it well; most ideas never reach them.
- Grade the idea as described, for a solo developer or small team. Base it on demand (are players showing up for this), competition (how many games, how entrenched), timing (rising, peaked, fading), and buildability (scope a small team can ship).

Writing
- Lead with the verdict, then the evidence, then what would change your mind. Keep it tight: short paragraphs, a small table when comparing games. No filler and no pep talk.`;

const GRADE_TOOL: Anthropic.Beta.BetaTool = {
  name: "record_grade",
  description: "Record your grade for the idea under discussion so it shows on the idea's page. Call this every time you give or revise a verdict on an idea.",
  input_schema: {
    type: "object",
    properties: {
      grade: { type: "string", enum: [...GRADES] },
      reason: { type: "string", description: "One or two sentences: the main evidence behind the grade." },
      title: { type: "string", description: "A short name for the idea (3-6 words)." },
    },
    required: ["grade", "reason"],
  },
};

function tools(): Anthropic.Beta.BetaTool[] {
  const own = TOOLS.filter((t) => CHAT_TOOLS.has(t.name)).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool["input_schema"] }));
  return [...own, GRADE_TOOL];
}

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "grade"; grade: string; reason: string }
  | { type: "done"; model: string; cost: number }
  | { type: "error"; message: string };

export async function createChat(firstMessage: string): Promise<number> {
  const t = now();
  const title = firstMessage.replace(/\s+/g, " ").trim().slice(0, 70) || "New idea";
  const r = await run("INSERT INTO chats (title, created_at, updated_at) VALUES (?, ?, ?)", [title, t, t]);
  return Number(r.lastInsertRowid);
}

async function loadMessages(chatId: number): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await q<{ role: string; content: string }>("SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY seq", [chatId]);
  return rows.map((r) => ({ role: r.role as "user" | "assistant", content: JSON.parse(r.content) }));
}

async function append(chatId: number, role: "user" | "assistant", content: unknown) {
  await run(
    "INSERT INTO chat_messages (chat_id, seq, role, content) VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_messages WHERE chat_id = ?), ?, ?)",
    [chatId, chatId, role, JSON.stringify(content)],
  );
}

const summarize = (name: string, input: Record<string, unknown>) => {
  const parts = Object.entries(input ?? {})
    .filter(([, v]) => v != null && typeof v !== "object")
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`);
  return parts.slice(0, 4).join(", ") || name;
};

/** Run one user turn to completion, emitting events as the reply streams. */
export async function runChatTurn(chatId: number, userText: string, emit: (e: ChatEvent) => void) {
  let cost = 0;
  let model = SONNET;
  try {
    const client = await getClient();
    model = await pickModel();
    const messages = await loadMessages(chatId);
    const user: Anthropic.Beta.BetaMessageParam = { role: "user", content: userText };
    messages.push(user);
    await append(chatId, "user", userText);

    for (let step = 0; step < 16; step++) {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: tools(),
        messages,
        output_config: { effort: "medium" },
        // If Sonnet's safety filter declines a request, the API retries it on
        // its default fallback model instead of failing the turn.
        ...(model === SONNET ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      stream.on("text", (delta) => emit({ type: "text", delta }));
      const message = await stream.finalMessage();
      cost += await recordUsage("chat", model, message.usage);

      if (message.stop_reason === "refusal") {
        emit({ type: "error", message: "Claude declined to answer that request." });
        break;
      }
      messages.push({ role: "assistant", content: message.content });
      await append(chatId, "assistant", message.content);
      if (message.stop_reason === "pause_turn") continue;

      const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (!calls.length) break;
      if (message.stop_reason === "max_tokens") {
        emit({ type: "error", message: "The reply was cut off before a tool call finished. Ask again, perhaps more narrowly." });
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
              await run("UPDATE chats SET grade = ?, grade_reason = ?, title = COALESCE(?, title) WHERE id = ?", [grade, reason, input.title ? String(input.title).slice(0, 70) : null, chatId]);
              emit({ type: "grade", grade, reason });
              return { type: "tool_result", tool_use_id: call.id, content: "Recorded." };
            }
            const tool = TOOLS.find((t) => t.name === call.name && CHAT_TOOLS.has(t.name));
            if (!tool) throw new Error(`Unknown tool ${call.name}`);
            emit({ type: "tool", name: call.name, summary: summarize(call.name, input) });
            const out = await tool.run(input);
            return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out, (_, v) => (typeof v === "bigint" ? Number(v) : v)).slice(0, 60_000) };
          } catch (e) {
            return { type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      messages.push({ role: "user", content: results });
      await append(chatId, "user", results);
    }
    await run("UPDATE chats SET updated_at = ? WHERE id = ?", [now(), chatId]);
    emit({ type: "done", model, cost });
  } catch (e) {
    emit({ type: "error", message: explainAiError(e) });
  }
}

export type ChatTurn = { role: "user" | "assistant"; text: string; tools: string[] };

type StoredBlock = { type: string; text?: string; name?: string };

/** Stored messages flattened for display: text plus the names of tools used. */
export async function getChatTurns(chatId: number): Promise<ChatTurn[]> {
  const rows = await q<{ role: string; content: string }>("SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY seq", [chatId]);
  const turns: ChatTurn[] = [];
  for (const r of rows) {
    const content = JSON.parse(r.content) as string | StoredBlock[];
    if (typeof content === "string") {
      turns.push({ role: r.role === "user" ? "user" : "assistant", text: content, tools: [] });
      continue;
    }
    if (r.role === "user") continue; // tool results
    const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const used = content.filter((b) => b.type === "tool_use" && b.name !== "record_grade").map((b) => b.name ?? "");
    const last = turns[turns.length - 1];
    if (last?.role === "assistant") {
      last.text += (last.text && text ? "\n\n" : "") + text;
      last.tools.push(...used);
    } else turns.push({ role: "assistant", text, tools: used });
  }
  return turns;
}

export async function listChats() {
  return q<{ id: number; title: string; grade: string | null; grade_reason: string | null; updated_at: number }>("SELECT id, title, grade, grade_reason, updated_at FROM chats ORDER BY updated_at DESC LIMIT 200");
}

export async function getChat(id: number) {
  const r = await q<{ id: number; title: string; grade: string | null; grade_reason: string | null; updated_at: number }>("SELECT id, title, grade, grade_reason, updated_at FROM chats WHERE id = ?", [id]);
  return r[0] ?? null;
}

export async function deleteChat(id: number) {
  await run("DELETE FROM chat_messages WHERE chat_id = ?", [id]);
  await run("DELETE FROM chats WHERE id = ?", [id]);
}
