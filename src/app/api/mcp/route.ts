import { TOOLS } from "@/lib/mcp-tools";
import { clientIp, rateCount, rateLimit, safeEqual, tooMany } from "@/lib/security";

// MCP over streamable HTTP, stateless: each POST carries JSON-RPC and gets a
// JSON reply. Point an MCP client at /api/mcp with "Authorization: Bearer
// <MCP_TOKEN>" (or ?key=<MCP_TOKEN> for clients that cannot set headers).
//
// Limits: 10 wrong tokens per address in 15 minutes locks that address out;
// a valid token may make 240 requests a minute.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INSTRUCTIONS =
  "Floppa Charts tracks thousands of Roblox games over time. Start with list_games (sorted by rise) or list_niches, drill in with get_game and get_game_history, and use search_roblox to check how crowded an idea is. All figures are concurrent players unless stated. Write tools are logged and undoable; say what you changed.";

const BAD_TOKEN = { limit: 10, window: 15 * 60 };

async function authorize(req: Request): Promise<Response | null> {
  const token = process.env.MCP_TOKEN;
  if (!token) {
    // No token configured: open on a home PC, closed anywhere hosted.
    return process.env.VERCEL ? Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "MCP is disabled until MCP_TOKEN is set." } }, { status: 401 }) : null;
  }
  const ip = clientIp(req.headers);
  if ((await rateCount(`mcp-bad:${ip}`, BAD_TOKEN.window)) >= BAD_TOKEN.limit) return tooMany(BAD_TOKEN.window, "Too many wrong tokens from this address. Try again in 15 minutes.");
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("key") ?? "";
  if (given.length > 300 || !safeEqual(given, token)) {
    await rateLimit(`mcp-bad:${ip}`, BAD_TOKEN.limit, BAD_TOKEN.window);
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, { status: 401 });
  }
  const use = await rateLimit("mcp:use", 240, 60);
  return use.ok ? null : tooMany(use.retryAfter);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, any> };

async function handle(msg: Rpc): Promise<object | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return null; // notification

  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "floppa-charts", version: "0.2.0" },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return error(-32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const out = await tool.run(msg.params?.arguments ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, (_, v) => (typeof v === "bigint" ? Number(v) : v)) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return error(-32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  const raw = await req.text();
  if (raw.length > 2_000_000) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, { status: 413 });
  let body: Rpc | Rpc[];
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    if (body.length > 20) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "At most 20 calls per batch" } }, { status: 400 });
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const out = await handle(body);
  return out ? Response.json(out) : new Response(null, { status: 202 });
}

export function GET() {
  return new Response("This endpoint speaks MCP over POST.", { status: 405, headers: { Allow: "POST" } });
}
