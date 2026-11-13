import { getApiKey } from "@/lib/ai";
import { createChat, runChatTurn, type ChatEvent } from "@/lib/chat";

// Streams one chat turn as newline-delimited JSON events.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { chatId?: number; message?: string; model?: string } | null;
  const message = body?.message?.trim();
  if (!message) return Response.json({ error: "Empty message" }, { status: 400 });
  if (!(await getApiKey())) {
    return new Response(JSON.stringify({ type: "error", message: "No Claude API key is set. Add one in Settings." }) + "\n", { headers: { "Content-Type": "application/x-ndjson" } });
  }
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
      await runChatTurn(chatId, message, send, body?.model);
      if (open) controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
