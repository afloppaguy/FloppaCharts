import Link from "next/link";
import { loadTotals } from "@/lib/analytics";
import { num } from "@/lib/format";
import { compactNumber } from "@/lib/metric-format";
import { DEVEX_RATE, fmtUsd } from "@/lib/money";

export const TOTAL_RANGES = [7, 28, 90];

const hours = (h: number) => (h >= 100 ? `${compactNumber(Math.round(h))} h` : `${h.toFixed(1)} h`);

function Big({ value, label, sub }: { value: string; label: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-muted/30 px-5 py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-sm text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

/** Every connected game added together: revenue (Robux and dollars), playtime, visits, players. */
export async function MyGamesTotals({ days }: { days: number }) {
  const t = await loadTotals(days);
  if (!t.games.length) return null;
  const failed = t.games.filter((g) => g.error);
  const share = (v: number, total: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : "–");

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-base font-semibold tracking-tight">All games combined</h2>
          <span className="text-xs text-muted-foreground">Last {days} complete days</span>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5" role="group" aria-label="Period">
          {TOTAL_RANGES.map((d) => (
            <Link key={d} href={`/my-games?days=${d}`} aria-current={d === days ? "true" : undefined} className={`rounded-md px-2.5 py-1 text-xs ${d === days ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {d}d
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Big label="Total revenue" value={`${num(Math.round(t.revenue))} R$`} sub={<>≈ {fmtUsd(t.revenue * DEVEX_RATE)} through DevEx</>} />
        <Big label="Total playtime" value={hours(t.playHours)} sub={t.playHours >= 48 ? `${num(Math.round(t.playHours / 24))} days of play` : undefined} />
        <Big label="Total visits" value={num(Math.round(t.visits))} />
        <Big label="Daily players" value={num(Math.round(t.dau))} sub="average per day, games added together" />
      </div>

      {t.games.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-normal">Game</th>
                <th className="pb-2 text-right font-normal">Revenue</th>
                <th className="pb-2 text-right font-normal">In dollars</th>
                <th className="pb-2 text-right font-normal">Share</th>
                <th className="pb-2 text-right font-normal">Playtime</th>
                <th className="pb-2 text-right font-normal">Visits</th>
                <th className="pb-2 text-right font-normal">Daily players</th>
              </tr>
            </thead>
            <tbody>
              {t.games.map((g) => (
                <tr key={g.id} className="border-t border-border/60">
                  <td className="py-2">
                    <Link href={`/my-games/${g.id}`} className="font-medium hover:underline">
                      {g.name}
                    </Link>
                  </td>
                  {g.error ? (
                    <td colSpan={6} className="py-2 text-right text-xs text-rose-300">
                      Roblox did not return numbers for this game.
                    </td>
                  ) : (
                    <>
                      <td className="py-2 text-right tabular-nums">{num(Math.round(g.revenue))} R$</td>
                      <td className="py-2 text-right text-muted-foreground tabular-nums">{fmtUsd(g.revenue * DEVEX_RATE)}</td>
                      <td className="py-2 text-right text-muted-foreground tabular-nums">{share(g.revenue, t.revenue)}</td>
                      <td className="py-2 text-right tabular-nums">{hours(g.playHours)}</td>
                      <td className="py-2 text-right tabular-nums">{num(Math.round(g.visits))}</td>
                      <td className="py-2 text-right tabular-nums">{num(Math.round(g.dau))}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Dollars use the Developer Exchange rate of ${DEVEX_RATE} per Robux, before tax. Playtime is daily players × minutes per player, added over the period.
        {failed.length > 0 && t.games.length === 1 ? " Roblox did not return numbers for this game; open it for details." : ""}
      </p>
    </section>
  );
}
