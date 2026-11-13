import Link from "next/link";
import { Button } from "@/components/ui/button";
import { markAlertsRead } from "@/app/actions";
import { ago } from "@/lib/format";
import { getAlerts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const alerts = await getAlerts();
  const unread = alerts.filter((a) => !a.read).length;
  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground">Raised when a game on your watchlist jumps 50% or more in 24 hours.</p>
        </div>
        {unread > 0 && (
          <form action={markAlertsRead}>
            <Button variant="outline" size="sm" type="submit">
              Mark all read
            </Button>
          </form>
        )}
      </header>
      <div className="grid gap-0.5">
          {alerts.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No alerts yet. Watch a game to start getting them.</p>}
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
              <span className={`size-1.5 shrink-0 rounded-full ${a.read ? "bg-transparent" : "bg-sky-500"}`} />
              {a.universe_id ? (
                <Link href={`/games/${a.universe_id}`} className="flex-1 hover:underline">
                  {a.message}
                </Link>
              ) : (
                <span className="flex-1">{a.message}</span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">{ago(a.ts)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
