"use client";

import { useState } from "react";
import { GamePicker, type PickedGame } from "@/components/game-picker";
import { CREATOR_SHARE, DEVEX_MINIMUM, DEVEX_RATE, fmtRobux, fmtUsd } from "@/lib/money";

const field = "h-9 w-full rounded-lg bg-muted/60 px-3 text-sm tabular-nums outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";
const numberOf = (s: string) => {
  const n = Number(s.replace(/[\s,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

function Out({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/30 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 tabular-nums ${strong ? "text-2xl font-semibold tracking-tight" : "text-lg font-medium"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Pills<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5" role="group">
      {options.map((o) => (
        <button key={String(o.v)} type="button" aria-pressed={o.v === value} onClick={() => onChange(o.v)} className={`rounded-md px-2.5 py-1 text-xs ${o.v === value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Robux in, real money out. */
export function RobuxConverter() {
  const [amount, setAmount] = useState("100000");
  const [kind, setKind] = useState<"spent" | "earned">("spent");
  const [rate, setRate] = useState(String(DEVEX_RATE));
  const [fx, setFx] = useState("");
  const robux = numberOf(amount);
  const earned = kind === "spent" ? robux * CREATOR_SHARE : robux;
  const usd = earned * numberOf(rate);
  const local = numberOf(fx) > 0 ? usd * numberOf(fx) : null;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_auto] sm:items-end">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Robux
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
        </label>
        <Pills
          value={kind}
          onChange={setKind}
          options={[
            { v: "spent", label: "Players spent this" },
            { v: "earned", label: "I already earned this" },
          ]}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {kind === "spent" && <Out label={`You receive (${Math.round(CREATOR_SHARE * 100)}% after Roblox's cut)`} value={fmtRobux(earned)} />}
        <Out label="Cashed out through DevEx" value={fmtUsd(usd)} sub={`${numberOf(rate)} USD per Robux`} strong />
        {local != null && <Out label="In your currency" value={local.toLocaleString("en-US", { maximumFractionDigits: 0 })} sub={`at ${numberOf(fx)} per dollar`} />}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs text-muted-foreground">
          DevEx rate (USD per Robux)
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={field} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Your currency per 1 USD (optional)
          <input inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} placeholder="e.g. 9.5 for SEK" className={field} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {earned < DEVEX_MINIMUM
          ? `Below the cash-out minimum: DevEx needs ${DEVEX_MINIMUM.toLocaleString("en-US")} earned Robux (${fmtUsd(DEVEX_MINIMUM * DEVEX_RATE)}).`
          : `Above the ${DEVEX_MINIMUM.toLocaleString("en-US")} Robux cash-out minimum.`}{" "}
        Robux earned before 5 September 2025 cash out at the older 0.0035 rate. Taxes and payment fees are not included.
      </p>
    </div>
  );
}

type Loaded = { id: number; name: string; playing: number; visits: number; visitsPerDay: number | null; basis: string };
const PER_VISIT = [
  { v: 0.5, label: "Low", help: "Weak monetization, or mostly young free players" },
  { v: 1.5, label: "Typical", help: "A game with working game passes and products" },
  { v: 4, label: "Strong", help: "A game built around spending" },
];

/** A rough range for what any tracked game earns, from its visits. */
export function GameEstimate() {
  const [game, setGame] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");

  const load = async (g: PickedGame) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/tools/earnings?id=${g.id}`);
      const j = (await r.json()) as Loaded & { error?: string };
      if (!r.ok || j.error) throw new Error(j.error ?? "Could not load that game.");
      setGame(j);
    } catch (e) {
      setGame(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const rows = numberOf(custom) > 0 ? [...PER_VISIT, { v: numberOf(custom), label: "Yours", help: "Your own figure" }] : PER_VISIT;

  return (
    <div className="grid gap-4">
      <GamePicker name="game" placeholder="Type a game's name" onPick={load} className="max-w-md" />
      {busy && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      {game && (
        <>
          <p className="text-sm">
            <span className="font-medium">{game.name}</span>
            <span className="text-muted-foreground">
              {" "}
              · {game.playing.toLocaleString("en-US")} playing now ·{" "}
              {game.visitsPerDay != null ? `${game.visitsPerDay.toLocaleString("en-US")} visits a day, ${game.basis}` : "no visit rate measured yet; open it again in a few hours"}
            </span>
          </p>
          {game.visitsPerDay != null && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-normal">Robux earned per visit</th>
                    <th className="pb-2 text-right font-normal">Robux a day</th>
                    <th className="pb-2 text-right font-normal">USD a day</th>
                    <th className="pb-2 text-right font-normal">USD a month</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const day = game.visitsPerDay! * r.v;
                    return (
                      <tr key={r.label} className="border-t border-border/60">
                        <td className="py-2">
                          <span className="font-medium">{r.label}</span> <span className="text-muted-foreground tabular-nums">{r.v} R$</span>
                          <span className="block text-xs text-muted-foreground">{r.help}</span>
                        </td>
                        <td className="py-2 text-right tabular-nums">{fmtRobux(day)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtUsd(day * DEVEX_RATE)}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{fmtUsd(day * DEVEX_RATE * 30)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <label className="grid max-w-xs gap-1 text-xs text-muted-foreground">
            Your own Robux per visit (optional)
            <input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Revenue ÷ visits from one of your games" className={field} />
          </label>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        This is a rough range, not a measurement. Visits are measured by the tracker; what a visit is worth is not public, so the three rows are assumptions. For a real figure, divide Revenue by Visits on one of your own games in My games and enter it above.
      </p>
    </div>
  );
}
