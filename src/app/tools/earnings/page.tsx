import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EarningsCalculator } from "@/components/earnings-calculator";
import { PageHeader } from "@/components/page-parts";
import { getRates, savedGames } from "@/lib/earnings";
import { uidNow } from "@/lib/scope";

export const dynamic = "force-dynamic";

export default async function EarningsPage() {
  const [rates, games] = await Promise.all([getRates(), savedGames(await uidNow()).catch(() => [])]);
  return (
    <div className="mx-auto grid max-w-5xl gap-8">
      <div className="grid gap-4">
        <Link href="/tools" className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Tools
        </Link>
        <PageHeader title="Earnings calculator" subtitle="Turn Robux into real money, and keep a list of games to see roughly what each one earns." />
      </div>
      <EarningsCalculator rates={rates} initialGames={games} />
    </div>
  );
}
