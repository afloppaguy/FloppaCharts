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
