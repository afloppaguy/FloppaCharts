import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { sessionValue } from "@/proxy";

async function login(formData: FormData) {
  "use server";
  const password = process.env.DASH_PASSWORD;
  if (password && String(formData.get("password") ?? "") === password) {
    (await cookies()).set("radar_session", await sessionValue(password), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" });
    redirect("/");
  }
  redirect("/login?wrong=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ wrong?: string }> }) {
  const { wrong } = await searchParams;
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-80">
        <CardHeader>
          <CardTitle>Floppa Charts</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={login} className="grid gap-3">
            <Input type="password" name="password" placeholder="Password" autoFocus required />
            {wrong && <p className="text-xs text-red-400">Wrong password.</p>}
            <Button type="submit">Unlock</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
