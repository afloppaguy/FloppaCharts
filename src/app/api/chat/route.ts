import { getApiKey } from "@/lib/ai";
import { createChat, runChatTurn, type ChatEvent } from "@/lib/chat";

// Streams one chat turn as newline-delimited JSON events.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { chatId?: number; message?: string } | null;
  const message = body?.message?.trim();
  if (!message) return Response.json({ error: "Empty message" }, { status: 400 });
  if (!(await getApiKey())) return new Response(JSON.stringify({ type: "error", message: "No Claude API key is set. Add one in Settings." }) + "\n", { headers: { "Content-Type": "application/x-ndjson" } });
  const chatId = body?.chatId ?? (await createChat(message));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatEvent | { type: "chat"; id: number }) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      send({ type: "chat", id: chatId });
      await runChatTurn(chatId, message, send);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
