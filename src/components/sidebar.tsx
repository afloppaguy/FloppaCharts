import Link from "next/link";
import { cookies } from "next/headers";
import { validSession } from "@/proxy";
import { Bell, Cat, ChartLine, Compass, Eye, GitCompareArrows, History, Home, Lightbulb, Settings, Shapes, Sparkles } from "lucide-react";
import { NavLink } from "@/components/quick-actions";
import { now } from "@/lib/db";
import { ago, num } from "@/lib/format";
import { getStatusLight } from "@/lib/queries";

export async function Sidebar() {
  // The login screen shows no navigation and no numbers to someone who is not signed in.
  const password = process.env.DASH_PASSWORD;
  if (password && !(await validSession(password, (await cookies()).get("radar_session")?.value))) return null;

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
    { href: "/gaps", match: "/gaps", label: "Gap finder", icon: Sparkles },
    { href: "/my-games", match: "/my-games", label: "My games", icon: ChartLine },
  ];
  const system: Item[] = [
    { href: "/activity", match: "/activity", label: "Activity", icon: History },
    { href: "/settings", match: "/settings", label: "Settings", icon: Settings },
  ];
  const stale = status?.lastCycle ? now() - status.lastCycle.ts > 3600 : true;
  return (
    <>
      {/* Phones: a top bar with the same destinations in a row that scrolls sideways. */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur md:hidden">
        <nav className="flex items-center gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none]" aria-label="Main">
          <Link href="/" aria-label="Floppa Charts home" className="mr-1 flex shrink-0 items-center">
            <Cat className="size-5 text-sky-400" />
          </Link>
          {[...links, ...work, ...system].map((l) => (
            <NavLink key={l.label} href={l.href} match={l.match} compact>
              <l.icon className="size-4" />
              <span>{l.label}</span>
              {l.badge ? <span className="rounded-full bg-sky-500 px-1.5 text-[10px] font-medium text-white">{l.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
      </header>
    <aside className="sticky top-0 hidden h-screen w-48 shrink-0 flex-col px-3 py-6 md:flex 2xl:w-56">
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
        <div className="mt-1 opacity-70">Ctrl K to search</div>
      </div>
    </aside>
    </>
  );
}
