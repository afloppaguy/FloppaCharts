import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Cat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientIp, rateCount, rateLimit, rateReset, safeEqual } from "@/lib/security";
import { createSession } from "@/proxy";

// Sign-in limits: 5 wrong passwords per address in 15 minutes, and 30 wrong
// passwords from anywhere in an hour, after which sign-in pauses for everyone.
const PER_IP = { limit: 5, window: 15 * 60 };
const GLOBAL = { limit: 30, window: 60 * 60 };

async function login(formData: FormData) {
  "use server";
  const password = process.env.DASH_PASSWORD;
  if (!password) redirect("/");
  const ip = clientIp(await headers());
  const ipKey = `login:${ip}`;

  // Already locked out: refuse without even checking the password.
  const [ipUsed, globalUsed] = await Promise.all([rateCount(ipKey, PER_IP.window), rateCount("login:all", GLOBAL.window)]);
  if (ipUsed >= PER_IP.limit || globalUsed >= GLOBAL.limit) redirect("/login?locked=1");

  const given = String(formData.get("password") ?? "");
  if (given.length <= 200 && safeEqual(given, password)) {
    await rateReset(ipKey);
    const session = await createSession(password);
    (await cookies()).set("radar_session", session.value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: session.maxAge, path: "/" });
    redirect("/");
  }

  // Wrong password: count it, and make guessing slow.
  await Promise.all([rateLimit(ipKey, PER_IP.limit, PER_IP.window), rateLimit("login:all", GLOBAL.limit, GLOBAL.window)]);
  await new Promise((r) => setTimeout(r, 800));
  redirect("/login?wrong=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ wrong?: string; locked?: string }> }) {
  const { wrong, locked } = await searchParams;
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <form action={login} className="grid w-full max-w-xs gap-3 rounded-2xl bg-muted/30 p-6">
        <div className="mb-1 flex items-center gap-2 text-base font-semibold tracking-tight">
          <Cat className="size-5 text-sky-400" /> Floppa Charts
        </div>
        <Input type="password" name="password" placeholder="Password" aria-label="Password" autoComplete="current-password" autoFocus required maxLength={200} />
        {locked ? (
          <p className="text-xs text-amber-300">Too many wrong attempts. Sign-in is paused for a while; try again in 15 minutes.</p>
        ) : wrong ? (
          <p className="text-xs text-rose-300">Wrong password.</p>
        ) : null}
        <Button type="submit">Unlock</Button>
      </form>
    </div>
  );
}
