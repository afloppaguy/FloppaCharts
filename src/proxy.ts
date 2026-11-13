import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Gate in front of every page and API route.
//
//   - With DASH_PASSWORD set, every request needs a valid session cookie.
//   - On a hosted deployment with no DASH_PASSWORD, nothing is served at all
//     (a public dashboard with AI keys behind it must never be open by accident).
//   - On a home PC with no DASH_PASSWORD, the dashboard is open.
//   - /api/mcp is exempt here because it checks its own token.
//   - Requests that change something must come from this site itself.

const SESSION_DAYS = 30;
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sign(password: string, payload: string): Promise<string> {
  // The signing key comes from the password (plus SESSION_SECRET if set), so
  // changing either one signs everyone out.
  const material = await crypto.subtle.digest("SHA-256", enc.encode(`floppa-session:${password}:${process.env.SESSION_SECRET ?? ""}`));
  const key = await crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** A session cookie value: an expiry time and a signature over it. It contains nothing secret. */
export async function createSession(password: string): Promise<{ value: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 86400;
  const expires = String(Math.floor(Date.now() / 1000) + maxAge);
  return { value: `${expires}.${await sign(password, expires)}`, maxAge };
}

export async function validSession(password: string, cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false;
  const [expires, signature] = cookie.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now() / 1000) return false;
  const expected = await sign(password, expires);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
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
