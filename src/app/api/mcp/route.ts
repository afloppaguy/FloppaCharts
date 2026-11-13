import { timingSafeEqual } from "node:crypto";
import { TOOLS } from "@/lib/mcp-tools";

// MCP over streamable HTTP, stateless: each POST carries JSON-RPC and gets a
// JSON reply. Point an MCP client at /api/mcp with "Authorization: Bearer
// <MCP_TOKEN>" (or ?key=<MCP_TOKEN> for clients that cannot set headers).

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INSTRUCTIONS =
  "Floppa Charts tracks thousands of Roblox games over time. Start with list_games (sorted by rise) or list_niches, drill in with get_game and get_game_history, and use search_roblox to check how crowded an idea is. All figures are concurrent players unless stated. Write tools are logged and undoable; say what you changed.";

function authorized(req: Request): boolean {
  const token = process.env.MCP_TOKEN;
  if (!token) return !process.env.VERCEL; // open on a local machine only
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
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
        serverInfo: { name: "floppa-charts", version: "0.1.0" },
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
  if (!authorized(req)) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, { status: 401 });
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const out = await handle(body);
  return out ? Response.json(out) : new Response(null, { status: 202 });
}

export function GET() {
  return new Response("This endpoint speaks MCP over POST.", { status: 405, headers: { Allow: "POST" } });
}
