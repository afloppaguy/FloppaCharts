import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { q } from "@/lib/db";

// Gate in front of every page and API route.
//
//   - With DASH_PASSWORD set, every request needs a valid session cookie.
//   - On a hosted deployment with no DASH_PASSWORD, nothing is served at all
//     (a public dashboard with AI keys behind it must never be open by accident).
//   - On a home PC with no DASH_PASSWORD, the dashboard is open.
//   - /api/mcp is exempt here because it checks its own token.
//   - Requests that change something must come from this site itself.
//
// Two kinds of session: the owner's (signed in with DASH_PASSWORD) and a
// member's (their own password, added in Settings). A member's session stops
// working as soon as the member is removed.

const SESSION_DAYS = 30;
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sign(password: string, payload: string): Promise<string> {
  // The signing key comes from the owner's password (plus SESSION_SECRET if
  // set), so changing either one signs everyone out.
  const material = await crypto.subtle.digest("SHA-256", enc.encode(`floppa-session:${password}:${process.env.SESSION_SECRET ?? ""}`));
  const key = await crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** A session cookie value: who (owner, or member number), an expiry time, and a signature. Nothing secret. */
export async function createSession(password: string, memberId?: number): Promise<{ value: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 86400;
  const expires = String(Math.floor(Date.now() / 1000) + maxAge);
  const payload = memberId ? `m${memberId}.${expires}` : expires;
  return { value: `${payload}.${await sign(password, payload)}`, maxAge };
}

export type Session = { owner: true; memberId: null } | { owner: false; memberId: number };

/** Checks the signature and expiry only. A member's session must also pass memberExists(). */
export async function readSession(password: string, cookie: string | undefined): Promise<Session | null> {
  if (!cookie) return null;
  const parts = cookie.split(".");
  const signature = parts.pop() ?? "";
  const payload = parts.join(".");
  const member = parts.length === 2 && /^m\d+$/.test(parts[0]) ? Number(parts[0].slice(1)) : null;
  const expires = parts[parts.length - 1];
  if ((parts.length !== 1 && member == null) || !expires || !/^\d+$/.test(expires)) return null;
  if (Number(expires) < Date.now() / 1000) return null;
  const expected = await sign(password, payload);
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return null;
  return member == null ? { owner: true, memberId: null } : { owner: false, memberId: member };
}

// Remembered for half a minute so a member's requests do not each cost a database lookup.
const memberCache = new Map<number, { ok: boolean; at: number }>();
export async function memberExists(id: number): Promise<boolean> {
  const hit = memberCache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  let ok = false;
  try {
    ok = (await q("SELECT 1 FROM members WHERE id = ?", [id])).length > 0;
  } catch {
    return hit?.ok ?? false; // database unreachable: keep the last known answer, otherwise refuse
  }
  memberCache.set(id, { ok, at: Date.now() });
  return ok;
}
export const forgetMember = (id: number) => memberCache.delete(id);

export async function validSession(password: string, cookie: string | undefined): Promise<boolean> {
  const s = await readSession(password, cookie);
  return !!s && (s.owner || (await memberExists(s.memberId)));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/mcp")) return NextResponse.next();

  // Anything that changes state must come from this site: blocks forged
  // requests sent from other websites while you are signed in.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return new NextResponse("Cross-site request refused.", { status: 403 });
  }

  const password = process.env.DASH_PASSWORD;
  if (!password) {
    if (process.env.VERCEL) return new NextResponse("This dashboard is locked: set the DASH_PASSWORD environment variable and redeploy.", { status: 503 });
    return NextResponse.next();
  }
  if (pathname === "/login") return NextResponse.next();
  if (await validSession(password, request.cookies.get("radar_session")?.value)) return NextResponse.next();

  // API calls get a plain 401; pages are sent to the login screen.
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // The app manifest and icons stay public so the browser can offer "install".
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-192.png|icon-512.png|robots.txt).*)"],
};
