import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Single-password lock for the dashboard. Set DASH_PASSWORD to turn it on;
// without it (local use) everything is open. /api/mcp has its own token.

export async function sessionValue(password: string): Promise<string> {
  const data = new TextEncoder().encode(`roblox-radar:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function proxy(request: NextRequest) {
  const password = process.env.DASH_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/mcp")) return NextResponse.next();
  if (request.cookies.get("radar_session")?.value === (await sessionValue(password))) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // The app manifest and icons stay public so the browser can offer "install".
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-192.png|icon-512.png).*)"],
};
