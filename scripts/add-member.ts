// Adds a person with their own dashboard password (stored as a one-way hash).
//   npx tsx scripts/add-member.ts "Name" "their password"
// The same can be done in the dashboard under Settings > People.
try {
  process.loadEnvFile(".env.local");
} catch {}
import { now, q, run } from "../src/lib/db";
import { hashPassword, verifyPassword } from "../src/lib/security";

(async () => {
  const [name, password] = process.argv.slice(2);
  if (!name || !password || password.length < 8) throw new Error('Usage: npx tsx scripts/add-member.ts "Name" "password of 8+ characters"');
  const members = await q<{ id: number; name: string; pass_hash: string }>("SELECT id, name, pass_hash FROM members");
  if (members.some((m) => verifyPassword(password, m.pass_hash))) throw new Error("Someone already has that password.");
  await run("INSERT INTO members (name, pass_hash, created_at) VALUES (?, ?, ?)", [name.slice(0, 40), hashPassword(password), now()]);
  const all = await q<{ id: number; name: string }>("SELECT id, name FROM members ORDER BY id");
  console.log("People with their own password:", all.map((m) => `#${m.id} ${m.name}`).join(", "));
  process.exit(0);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
