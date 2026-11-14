import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GameEstimate, RobuxConverter } from "@/components/earnings-calculator";
import { PageHeader, Section } from "@/components/page-parts";

export default function EarningsPage() {
  return (
    <div className="mx-auto grid max-w-4xl gap-10">
      <div className="grid gap-4">
        <Link href="/tools" className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Tools
        </Link>
        <PageHeader title="Earnings calculator" subtitle="Turn Robux into real money, and get a rough idea of what any game earns." />
      </div>
      <Section title="Robux to money" hint="After Roblox's cut and Developer Exchange">
        <RobuxConverter />
      </Section>
      <Section title="What does a game earn?" hint="A rough range from its visits">
        <GameEstimate />
      </Section>
    </div>
  );
}
