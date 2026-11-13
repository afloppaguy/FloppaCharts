// Usage: npm run collect            one pass (default 10 minutes)
//        npm run collect -- 3       one 3-minute pass
//        npm run collect:loop       keep collecting until stopped
import { cycle } from "../src/lib/collector";

const args = process.argv.slice(2);
const loop = args.includes("--loop");
const minutes = Number(args.find((a) => /^\d+(\.\d+)?$/.test(a)) ?? "10");

(async () => {
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
