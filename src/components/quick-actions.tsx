"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Eye, LayoutGrid, List } from "lucide-react";
import { toast } from "sonner";
import { setView, toggleWatch } from "@/app/actions";
import { cn } from "@/lib/utils";

/** One-click watch toggle used on rows and cards. Stays visible once a game is watched. */
export function WatchToggle({ id, watched, className }: { id: number; watched: boolean; className?: string }) {
  const [on, setOn] = useState(watched);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={on ? "Stop watching" : "Watch this game"}
      title={on ? "Watching (click to stop)" : "Watch"}
      aria-pressed={on}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await toggleWatch(id, !on);
          if (r.ok) setOn(!on);
          else toast.error(r.message);
        })
      }
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md transition-opacity outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
        on ? "text-sky-400 opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground",
        className,
      )}
    >
      <Eye className="size-4" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.2 : 0} />
    </button>
  );
}

export type View = "list" | "grid";

/** Grid/list switch. The choice is remembered in a cookie so every page opens in the same view. */
export function ViewToggle({ view }: { view: View }) {
  const [pending, start] = useTransition();
  const set = (v: View) => start(() => setView(v));
  const item = (v: View, Icon: typeof List, label: string) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={view === v}
      disabled={pending}
      onClick={() => set(v)}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
        view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {item("grid", LayoutGrid, "Grid view")}
      {item("list", List, "List view")}
    </div>
  );
}

export function NavLink({ href, match, children }: { href: string; match: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = match === "/" ? pathname === "/" : pathname.startsWith(match);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
