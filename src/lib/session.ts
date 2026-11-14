import { cookies } from "next/headers";
import { q } from "./db";
import { memberExists, readSession } from "@/proxy";

export type CurrentUser = { owner: boolean; memberId: number | null; name: string };

/** Who is making this request. With no password configured (a home PC), everyone is the owner. */
export async function currentUser(): Promise<CurrentUser | null> {
  const password = process.env.DASH_PASSWORD;
  if (!password) return { owner: true, memberId: null, name: "Owner" };
  const s = await readSession(password, (await cookies()).get("radar_session")?.value);
  if (!s) return null;
  if (s.owner) return { owner: true, memberId: null, name: "Owner" };
  if (!(await memberExists(s.memberId))) return null;
  const row = await q<{ name: string }>("SELECT name FROM members WHERE id = ?", [s.memberId]);
  return { owner: false, memberId: s.memberId, name: row[0]?.name ?? "Member" };
}

/** Keys, budget and people are the owner's to change. */
export async function requireOwner() {
  const u = await currentUser();
  if (!u?.owner) throw new Error("Only the owner can change this.");
}
