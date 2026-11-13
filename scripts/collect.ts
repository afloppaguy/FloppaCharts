// Usage: npm run collect            one pass (default 10 minutes)
//        npm run collect -- 3       one 3-minute pass
//        npm run collect:loop       keep collecting until stopped
import { cycle } from "../src/lib/collector";

const args = process.argv.slice(2);
const loop = args.includes("--loop");
const minutes = Number(args.find((a) => /^\d+(\.\d+)?$/.test(a)) ?? "10");

// Load .env.local when it exists (a home PC); on GitHub the values come from repository secrets.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no file: fine
}

/** On GitHub, "::error::" lines show up on the run's summary page. */
function fail(message: string): never {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : message);
  process.exit(1);
}

(async () => {
  // On a CI machine a missing database address would silently collect into a
  // file that is thrown away when the run ends. Refuse instead, and say why.
  if (process.env.CI) {
    const url = (process.env.TURSO_DATABASE_URL ?? "").trim();
    const token = (process.env.TURSO_AUTH_TOKEN ?? "").trim();
    if (!url) fail("The TURSO_DATABASE_URL secret is empty or missing. Add it under Settings > Secrets and variables > Actions > Repository secrets.");
    if (!url.startsWith("libsql://")) fail(`The TURSO_DATABASE_URL secret should start with libsql:// but starts with "${url.slice(0, 9)}" (${url.length} characters). Paste only the address, without the name or an = sign.`);
    if (!token) fail("The TURSO_AUTH_TOKEN secret is empty or missing.");
    if (!token.startsWith("eyJ")) fail(`The TURSO_AUTH_TOKEN secret does not look like a Turso token (${token.length} characters). Paste only the token itself.`);
  }
  do {
    try {
      await cycle(minutes);
    } catch (e) {
      console.error("cycle failed:", e);
      if (!loop) fail(`Collection failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400));
      await new Promise((r) => setTimeout(r, 30_000));
    }
  } while (loop);
  process.exit(0);
})();
