import { getApiKey } from "@/lib/ai";
import { createChat, getChat, runChatTurn, type ChatEvent } from "@/lib/chat";
import { runAs, uidNow } from "@/lib/scope";
import { rateLimit, tooMany } from "@/lib/security";

// Streams one chat turn as newline-delimited JSON events.
// Limits: 12 messages a minute and 300 a day, on top of the monthly budget.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { chatId?: number; message?: string; model?: string } | null;
  const message = body?.message?.trim();
  if (!message) return Response.json({ error: "Empty message" }, { status: 400 });
  if (message.length > 12_000) return Response.json({ error: "That message is too long. Keep it under 12,000 characters." }, { status: 413 });
  if (body?.chatId != null && !Number.isInteger(body.chatId)) return Response.json({ error: "Bad conversation id" }, { status: 400 });
  if (!(await getApiKey())) {
    return new Response(JSON.stringify({ type: "error", message: "No Claude API key is set. Add one in Settings." }) + "\n", { headers: { "Content-Type": "application/x-ndjson" } });
  }
  const uid = await uidNow();
  const minute = await rateLimit(`chat:minute:${uid}`, 12, 60);
  if (!minute.ok) return tooMany(minute.retryAfter, "You are sending messages very quickly. Wait a moment.");
  const day = await rateLimit(`chat:day:${uid}`, 300, 86400);
  if (!day.ok) return tooMany(day.retryAfter, "Daily message limit reached (300). It resets within a day.");

  // A conversation can only be continued by the person who started it.
  if (body?.chatId != null && !(await getChat(body.chatId))) return Response.json({ error: "That conversation does not exist." }, { status: 404 });
  const chatId = body?.chatId ?? (await createChat(message));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: ChatEvent | { type: "chat"; id: number }) => {
        // The reader may have gone away (closed tab); the turn still finishes and is saved.
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      send({ type: "chat", id: chatId });
      // The reply outlives this request, so it is pinned to the person who asked.
      await runAs(uid, () => runChatTurn(chatId, message, send, body?.model));
      if (open) controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
