import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getClient, HAIKU, recordUsage } from "./ai";
import { q } from "./db";
import { clearNicheCache } from "./niches";
import { addTags } from "./ops";

// AI tagging: label games with their theme and core mechanic so niches can be
// grouped by what games actually are, not by the words in their titles.
// Always uses Haiku 5.5; a batch of 40 games costs a fraction of a cent.

const Tagged = z.object({
  games: z.array(
    z.object({
      universe_id: z.number(),
      themes: z.array(z.string()).describe("1-2 setting or subject tags, e.g. 'brainrot', 'anime', 'horror', 'farming', 'cars'"),
      mechanics: z.array(z.string()).describe("1-2 core-loop tags, e.g. 'tower defense', 'idle clicker', 'ragdoll physics', 'steal and defend', 'obby'"),
    }),
  ),
});

const SYSTEM = `You label Roblox games for a market-research dashboard. For each game you get its title, Roblox genre, and description. Return tags that say what the game is, so that similar games end up sharing tags.

Rules for tags:
- Lowercase, 1-3 words, singular where natural. Reuse a common established label over inventing a new one ("tower defense", not "defend the tower game").
- themes: the setting or subject a player would name (1-2 tags).
- mechanics: what the player actually does in the core loop (1-2 tags).
- Describe only what the title and description support. If a game's text is too vague to tell, return empty arrays for it instead of guessing.
- Never use marketing words (fun, new, update, best), Roblox itself, or the developer's name as tags.`;

type Row = { universe_id: number; name: string; description: string | null; genre_l1: string | null; genre_l2: string | null };

export async function tagGames(ids: number[], actor: "you" | "ai" = "ai") {
  if (!ids.length) return { tagged: 0, cost: 0 };
  const rows = await q<Row>(`SELECT universe_id, name, description, genre_l1, genre_l2 FROM games WHERE universe_id IN (${ids.map(Number).filter(Number.isFinite).join(",")})`);
  const client = await getClient();
  let tagged = 0;
  let cost = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const listing = batch
      .map((g) => `universe_id: ${g.universe_id}\ntitle: ${g.name}\ngenre: ${[g.genre_l1, g.genre_l2].filter(Boolean).join(" > ") || "unknown"}\ndescription: ${(g.description ?? "").replace(/\s+/g, " ").slice(0, 500) || "(none)"}`)
      .join("\n\n---\n\n");
    const response = await client.messages.parse({
      model: HAIKU,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Tag these ${batch.length} games.\n\n${listing}` }],
      output_config: { format: zodOutputFormat(Tagged), effort: "low" },
    });
    cost += await recordUsage("tagging", HAIKU, response.usage);
    const known = new Set(batch.map((g) => Number(g.universe_id)));
    for (const g of response.parsed_output?.games ?? []) {
      if (!known.has(g.universe_id)) continue;
      const tags = [...g.themes, ...g.mechanics].slice(0, 4);
      if (tags.length) {
        await addTags(g.universe_id, tags, actor);
        tagged++;
      }
    }
  }
  clearNicheCache();
  return { tagged, cost };
}

/** The rising and charted games that have no tags yet. */
export async function untaggedRising(limit = 40): Promise<number[]> {
  const rows = await q<{ universe_id: number }>(
    `SELECT g.universe_id FROM games g
     WHERE g.playing >= 50 AND g.last_polled IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM tags t WHERE t.universe_id = g.universe_id)
     ORDER BY (g.charts LIKE '%up-and-coming%' OR g.charts LIKE '%top-trending%') DESC, g.rise_score DESC, g.playing DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => Number(r.universe_id));
}
