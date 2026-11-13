// Usage: npm run collect            one pass (default 10 minutes)
//        npm run collect -- 3       one 3-minute pass
//        npm run collect:loop       keep collecting until stopped
import { cycle } from "../src/lib/collector";

const args = process.argv.slice(2);
const loop = args.includes("--loop");
const minutes = Number(args.find((a) => /^\d+(\.\d+)?$/.test(a)) ?? "10");

(async () => {
  // On a CI machine a missing database address would silently collect into a
  // file that is thrown away when the run ends. Refuse instead.
  if (process.env.CI && !process.env.TURSO_DATABASE_URL?.startsWith("libsql://")) {
    console.error("TURSO_DATABASE_URL is not set. Add it (and TURSO_AUTH_TOKEN) under the repository's Settings > Secrets and variables > Actions.");
    process.exit(1);
  }
  do {
    try {
      await cycle(minutes);
    } catch (e) {
      console.error("cycle failed:", e);
      if (!loop) process.exit(1);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  } while (loop);
  process.exit(0);
})();
