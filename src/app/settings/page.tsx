import { Button } from "@/components/ui/button";
import { addRobloxKey, deleteRobloxKey, logoutAction, removeClaudeKey, saveBudget, saveClaudeKey } from "@/app/actions";
import { ago } from "@/lib/format";
import { PageHeader, Section } from "@/components/page-parts";
import { AutoTagToggle, ModelPicker } from "@/components/ai-buttons";
import { getAutoTag } from "@/lib/insights";
import { getApiKey, getBudget, modelLabel, MODELS } from "@/lib/ai";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

const field = "h-8 rounded-lg bg-muted/60 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";
const mask = (k: string) => `${k.slice(0, 10)}…${k.slice(-4)}`;

export default async function SettingsPage() {
  const [key, budget, byPurpose, autoTag, robloxKeys] = await Promise.all([
    getApiKey(),
    getBudget(),
    q<{ purpose: string; calls: number; cost: number }>(
      "SELECT purpose, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM ai_usage WHERE ts >= CAST(strftime('%s', 'now', 'start of month') AS INTEGER) GROUP BY purpose ORDER BY cost DESC",
    ),
    getAutoTag(),
    q<{ id: number; label: string; created_at: number; games: number; names: string | null }>(
      "SELECT k.id, k.label, k.created_at, COUNT(g.universe_id) AS games, GROUP_CONCAT(g.name, ', ') AS names FROM rbx_keys k LEFT JOIN my_games g ON g.key_id = k.id GROUP BY k.id ORDER BY k.id",
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

      <Section title="Automatic AI work" hint="Runs quietly when you open the dashboard; always on Haiku">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm">
            Tag rising games automatically
            <div className="text-xs text-muted-foreground">Every six hours, up to 40 newly rising games get theme and mechanic tags, so the Themes niches stay filled. Well under a cent each time.</div>
          </div>
          <AutoTagToggle on={autoTag} />
        </div>
        <p className="text-xs text-muted-foreground">The daily briefing on the Home page is also written automatically, once a day, for about a cent.</p>
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

      <Section title="Roblox API keys" hint="For My games. One key per account or group; a key can cover several games">
        {robloxKeys.length > 0 && (
          <ul className="grid gap-1">
            {robloxKeys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 rounded-xl bg-muted/30 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{k.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {Number(k.games) ? `Used by ${k.names}` : "Not connected to a game yet"} · added {ago(k.created_at)}
                  </div>
                </div>
                <form action={deleteRobloxKey}>
                  <input type="hidden" name="id" value={k.id} />
                  <Button type="submit" variant="ghost" size="sm" title={Number(k.games) ? "Deletes the key and disconnects the games using it" : "Deletes the key"}>
                    Delete
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addRobloxKey} className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Name
            <input name="label" placeholder="Main account, My group…" maxLength={60} className={`${field} w-48`} />
          </label>
          <label className="grid flex-1 gap-1 text-xs text-muted-foreground">
            Open Cloud API key
            <input name="apiKey" type="password" autoComplete="off" required placeholder="Paste the key" className={`${field} w-full min-w-48`} />
          </label>
          <Button type="submit" size="sm">
            Add key
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Create keys on create.roblox.com under Open Cloud, API Keys. Give each one only the <span className="text-foreground">universe.analytics:read</span> permission for the games it should cover. Keys are stored encrypted.
        </p>
      </Section>

      <Section title="Security" hint="How this dashboard is protected">
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          <li>
            <span className="text-foreground">Sign-in:</span>{" "}
            {process.env.DASH_PASSWORD ? "password required. Five wrong attempts lock an address out for 15 minutes; sessions last 30 days." : "no password set, so anyone who can reach this address can use it. Fine on your own PC; a hosted copy refuses to run without one."}
          </li>
          <li>
            <span className="text-foreground">Saved keys:</span> your Claude and Roblox API keys are stored encrypted, and AI queries cannot read the tables that hold them.
          </li>
          <li>
            <span className="text-foreground">Limits:</span> 12 chat messages a minute and 300 a day; 240 AI-connection requests a minute; ten wrong connection tokens lock an address out.
          </li>
        </ul>
        {process.env.DASH_PASSWORD && (
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out on this device
            </Button>
          </form>
        )}
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
