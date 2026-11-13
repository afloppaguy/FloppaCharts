import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { undoEditAction } from "@/app/actions";
import { q } from "@/lib/db";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

type Edit = { id: number; ts: number; actor: string; action: string; detail: string; undo: string | null; undone: number };

export default async function ActivityPage() {
  const edits = await q<Edit>("SELECT id, ts, actor, action, detail, undo IS NOT NULL AS undo, undone FROM edit_log ORDER BY id DESC LIMIT 200");
  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Every change made by you or by an AI through the MCP connection. Most can be undone.</p>
      </header>
      <div className="grid gap-0.5">
          {edits.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No edits yet.</p>}
          {edits.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
              <Badge variant={e.actor === "ai" ? "default" : "secondary"} className="w-10 justify-center">
                {e.actor === "ai" ? "AI" : "You"}
              </Badge>
              <span className="w-40 shrink-0 font-medium">{e.action.replace(/_/g, " ")}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={e.detail}>
                {e.detail}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{ago(e.ts)}</span>
              {e.undone ? (
                <span className="w-14 text-center text-xs text-muted-foreground">undone</span>
              ) : e.undo ? (
                <form action={undoEditAction}>
                  <input type="hidden" name="id" value={e.id} />
                  <Button variant="ghost" size="xs" type="submit" className="w-14">
                    Undo
                  </Button>
                </form>
              ) : (
                <span className="w-14" />
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
