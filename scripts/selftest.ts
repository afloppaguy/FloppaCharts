// Offline checks for the pieces that cannot be exercised without real keys.
import { parseReply } from "../src/lib/analytics";
import { costOf, HAIKU, SONNET } from "../src/lib/ai";
import { terms } from "../src/lib/niches";

const sample = {
  path: "v1/universes/1234567890/operations/metrics/abc123",
  done: true,
  response: { values: [{ breakdowns: [{ dimension: "Platform", value: "Phone", displayValue: "Phone" }], dataPoints: [{ time: "2026-01-01T00:00:00Z", value: 10000 }, { time: "2026-01-02T00:00:00Z", value: 10500 }, { time: "2026-01-03T00:00:00Z" }] }] },
};
const s = parseReply(sample);
console.assert(s.length === 1 && s[0].points.length === 2 && s[0].breakdown.Platform === "Phone" && s[0].points[1].v === 10500, "parseReply");
console.assert(Math.abs(costOf(SONNET, { input_tokens: 1e6, output_tokens: 1e6 }) - 12) < 1e-9, "sonnet price");
console.assert(Math.abs(costOf(HAIKU, { input_tokens: 1e6, output_tokens: 1e6 }) - 0.6) < 1e-9, "haiku price");
console.assert(terms("[UPD] Hyper Realistic Ragdoll Engine 🔥").join("|") === "ragdoll|engine|ragdoll engine", "terms: " + terms("[UPD] Hyper Realistic Ragdoll Engine 🔥").join("|"));
console.log("selftest ok:", JSON.stringify(s[0]), terms("Steal a Brainrot"));

// A conversation damaged by an interrupted or doubled request must come out valid.
import { repairHistory } from "../src/lib/chat";
const damaged = [
  { role: "user" as const, content: "idea" },
  { role: "assistant" as const, content: [{ type: "text", text: "checking" }, { type: "tool_use", id: "a" }, { type: "tool_use", id: "b" }] },
  { role: "user" as const, content: "are you done?" },
  { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "a" }] },
  { role: "assistant" as const, content: [{ type: "tool_use", id: "c" }] },
];
const fixed = repairHistory(damaged);
const ids = (m: (typeof fixed)[number]) => (typeof m.content === "string" ? [] : m.content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
console.assert(fixed.length === 6 && ids(fixed[2]).join() === "a,b" && fixed[3].content === "are you done?" && ids(fixed[5]).join() === "c","repairHistory: " + JSON.stringify(fixed));
console.log("repairHistory ok");

// Security helpers: encryption round-trip, blocked tables, session signing.
import { assertSafeQuery, decryptSecret, encryptSecret, safeEqual } from "../src/lib/security";
import { createSession, validSession } from "../src/proxy";
(async () => {
  process.env.SECRETS_KEY = "selftest";
  const sealed = encryptSecret("sk-test-123");
  console.assert(sealed.startsWith("enc:v1:") && decryptSecret(sealed) === "sk-test-123" && decryptSecret("plain-old") === "plain-old", "encryption round-trip");
  console.assert(encryptSecret("a") !== encryptSecret("a"), "encryption must be randomised");
  const blocked = (sql: string) => { try { assertSafeQuery(sql); return false; } catch { return true; } };
  console.assert(blocked("select value from kv") && blocked("SELECT * FROM rbx_keys") && blocked("select * from sqlite_master") && !blocked("select name from games where playing > 5"), "blocked tables");
  console.assert(safeEqual("abc", "abc") && !safeEqual("abc", "abd") && !safeEqual("abc", "abcd"), "safeEqual");
  const s = await createSession("pw");
  const [exp, sig] = s.value.split(".");
  console.assert((await validSession("pw", s.value)) && !(await validSession("other", s.value)) && !(await validSession("pw", `${Number(exp) + 99}.${sig}`)) && !(await validSession("pw", `1.${sig}`)) && !(await validSession("pw", undefined)), "session signing");
  console.log("security ok");
})();
