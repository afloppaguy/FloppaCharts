import Link from "next/link";
import { Bell, Cat, ChartLine, Compass, Eye, GitCompareArrows, History, Home, Lightbulb, Settings, Shapes } from "lucide-react";
import { NavLink } from "@/components/quick-actions";
import { now } from "@/lib/db";
import { ago, num } from "@/lib/format";
import { getStatusLight } from "@/lib/queries";

export async function Sidebar() {
  let status: Awaited<ReturnType<typeof getStatusLight>> | null = null;
  try {
    status = await getStatusLight();
  } catch {
    status = null;
  }
  type Item = { href: string; match: string; label: string; icon: typeof Home; badge?: number };
  const links: Item[] = [
    { href: "/", match: "/", label: "Home", icon: Home },
    { href: "/games", match: "/games", label: "Explore", icon: Compass },
    { href: "/niches", match: "/niches", label: "Niches", icon: Shapes },
    { href: "/compare", match: "/compare", label: "Compare", icon: GitCompareArrows },
    { href: "/watchlist", match: "/watchlist", label: "Watchlist", icon: Eye },
    { href: "/alerts", match: "/alerts", label: "Alerts", icon: Bell, badge: status?.unreadAlerts || 0 },
  ];
  const work: Item[] = [
    { href: "/ideas", match: "/ideas", label: "Ideas", icon: Lightbulb },
    { href: "/my-games", match: "/my-games", label: "My games", icon: ChartLine },
  ];
  const system: Item[] = [
    { href: "/activity", match: "/activity", label: "Activity", icon: History },
    { href: "/settings", match: "/settings", label: "Settings", icon: Settings },
  ];
  const stale = status?.lastCycle ? now() - status.lastCycle.ts > 3600 : true;
  return (
    <aside className="sticky top-0 flex h-screen w-48 shrink-0 flex-col px-3 py-6">
      <Link href="/" className="mb-7 flex items-center gap-2 px-2.5 text-sm font-semibold tracking-tight">
        <Cat className="size-4 text-sky-400" />
        Floppa Charts
      </Link>
      <nav className="grid gap-5">
        {[links, work, system].map((group, i) => (
          <div key={i} className="grid gap-0.5">
            {group.map((l) => (
              <NavLink key={l.label} href={l.href} match={l.match}>
                <l.icon className="size-4" />
                <span className="flex-1">{l.label}</span>
                {l.badge ? <span className="rounded-full bg-sky-500 px-1.5 text-[10px] font-medium text-white">{l.badge}</span> : null}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="mt-auto px-2.5 text-xs leading-relaxed text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${stale ? "bg-amber-500" : "bg-emerald-500"}`} />
          Updated {ago(status?.lastCycle?.ts)}
        </div>
        <div>{num(status?.games ?? 0)} games tracked</div>
      </div>
    </aside>
  );
}
