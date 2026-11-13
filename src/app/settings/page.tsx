import { Button } from "@/components/ui/button";
import { removeClaudeKey, saveBudget, saveClaudeKey } from "@/app/actions";
import { PageHeader, Section } from "@/components/page-parts";
import { ModelPicker } from "@/components/ai-buttons";
import { getApiKey, getBudget, modelLabel, MODELS } from "@/lib/ai";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

const field = "h-8 rounded-lg bg-muted/60 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";
const mask = (k: string) => `${k.slice(0, 10)}…${k.slice(-4)}`;

export default async function SettingsPage() {
  const [key, budget, byPurpose] = await Promise.all([
    getApiKey(),
    getBudget(),
    q<{ purpose: string; calls: number; cost: number }>(
      "SELECT purpose, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM ai_usage WHERE ts >= CAST(strftime('%s', 'now', 'start of month') AS INTEGER) GROUP BY purpose ORDER BY cost DESC",
    ),
  ]);
  const usedPct = Math.min(100, (budget.spent / Math.max(budget.monthlyBudget, 0.01)) * 100);
  const mcpToken = !!process.env.MCP_TOKEN;

  return (
    <div className="mx-auto grid max-w-2xl gap-10">
      <PageHeader title="Settings" />

      <Section title="Claude API key" hint="Powers the idea chat, AI tagging and choke-point checks">
        {key ? (
          <div className="flex items-center gap-3 text-sm">
            <code className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">{mask(key.key)}</code>
            {key.source === "env" ? (
              <span className="text-xs text-muted-foreground">Set by the ANTHROPIC_API_KEY environment variable</span>
            ) : (
              <form action={removeClaudeKey}>
                <Button type="submit" variant="ghost" size="sm">
                  Remove
                </Button>
              </form>
            )}
          </div>
        ) : (
          <form action={saveClaudeKey} className="flex items-center gap-2">
            <input name="key" type="password" autoComplete="off" required placeholder="sk-ant-…" aria-label="Claude API key" className={`${field} w-80`} />
            <Button type="submit" size="sm">
              Save key
            </Button>
          </form>
        )}
        <p className="text-xs text-muted-foreground">
          Create a key at console.anthropic.com. When the dashboard is hosted, set it as the ANTHROPIC_API_KEY environment variable instead of saving it here.
        </p>
      </Section>

      <Section title="Model" hint="Used by the idea chat and choke-point checks. Nothing switches it for you.">
        <ModelPicker models={[...MODELS]} current={budget.model} />
        <p className="text-xs text-muted-foreground">You can also switch at the top of any chat. AI tagging and conversation summaries always use Haiku.</p>
      </Section>

      <Section title="AI budget" hint="Resets on the 1st of each month (UTC)">
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span>
              <span className="text-2xl font-semibold tracking-tight tabular-nums">${budget.remaining.toFixed(2)}</span>
              <span className="text-muted-foreground"> left of ${budget.monthlyBudget.toFixed(0)}</span>
            </span>
            <span className="text-xs text-muted-foreground">Current model: {modelLabel(budget.model)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${usedPct > 75 ? "bg-amber-500" : "bg-sky-500"}`} style={{ width: `${usedPct}%` }} />
          </div>
        </div>
        {byPurpose.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {byPurpose.map((p) => (
              <li key={p.purpose} className="flex justify-between text-muted-foreground">
                <span className="capitalize">
                  {p.purpose} <span className="text-xs">({p.calls} calls)</span>
                </span>
                <span className="tabular-nums">${Number(p.cost).toFixed(3)}</span>
              </li>
            ))}
          </ul>
        )}
        <form action={saveBudget} className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Monthly budget ($)
            <input name="monthlyBudget" type="number" min="0" step="1" defaultValue={budget.monthlyBudget} className={`${field} w-28`} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Actually left right now ($)
            <input name="remaining" type="number" min="0" step="0.01" placeholder="optional" className={`${field} w-32`} />
          </label>
          <Button type="submit" size="sm" variant="outline">
            Save
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          The dashboard only counts what it spends itself. If you use the same credits elsewhere, enter what is really left and it will correct its count.
        </p>
      </Section>

      <Section title="AI connection (MCP)" hint="Lets Claude and other assistants read and edit this data">
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p>
            Endpoint: <code className="rounded bg-muted/60 px-1.5 py-0.5 text-xs text-foreground">/api/mcp</code> on this site&apos;s address.
          </p>
          <p>
            {mcpToken
              ? "Protected by the MCP_TOKEN environment variable. Clients send it as a Bearer token, or as ?key=… on the address."
              : "No MCP_TOKEN is set, so the endpoint is open on this machine and refuses all requests once hosted. Set MCP_TOKEN before deploying."}
          </p>
        </div>
      </Section>
    </div>
  );
}
