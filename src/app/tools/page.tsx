import Link from "next/link";
import { Coins, ImageIcon } from "lucide-react";
import { PageHeader } from "@/components/page-parts";

const TOOLS = [
  {
    href: "/tools/thumbnail",
    icon: ImageIcon,
    name: "Thumbnail tester",
    blurb: "Drop in an icon or thumbnail and see it at a random spot among popular games' artwork, on desktop and phone, to judge whether it stands out.",
  },
  {
    href: "/tools/earnings",
    icon: Coins,
    name: "Earnings calculator",
    blurb: "Turn Robux into real money after Roblox's cut and DevEx, and get a rough range for what any tracked game earns from its visits.",
  },
];

export default function ToolsPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader title="Tools" subtitle="Small utilities for making and launching your game." />
      <div className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className="flex gap-4 rounded-2xl bg-muted/30 p-5 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
              <t.icon className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">{t.name}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t.blurb}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
