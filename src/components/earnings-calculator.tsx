"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import { GamePicker, type PickedGame } from "@/components/game-picker";
import type { GameEstimate, Rates } from "@/lib/earnings";
import { DEVEX_MINIMUM, DEVEX_RATE } from "@/lib/money";

/** Reads "1500", "1,500", "1.5k", "1.3m", "1.2b" (any case; "mil" and "bil" too). */
const numberOf = (s: string) => {
  const m = s.replace(/[\s,_]/g, "").toLowerCase().match(/^(\d*\.?\d+)(k|m|mil|b|bil)?$/);
  if (!m) return 0;
  const scale = !m[2] ? 1 : m[2] === "k" ? 1e3 : m[2].startsWith("m") ? 1e6 : 1e9;
  return Number(m[1]) * scale;
};

type Currency = "usd" | "eur" | "sek";
const CURRENCIES: { v: Currency; label: string }[] = [
  { v: "usd", label: "USD" },
  { v: "eur", label: "EUR" },
  { v: "sek", label: "SEK" },
];
const SHARES = [100, 75, 50, 25];
const PER_VISIT = [
  { v: 0.5, label: "Low", help: "Weak monetization" },
  { v: 1.5, label: "Typical", help: "Working passes and products" },
  { v: 4, label: "Strong", help: "Built around spending" },
];

const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const robuxText = (n: number) => `${whole(n)} R$`;
function money(usd: number, c: Currency, rates: Rates): string {
  const v = c === "usd" ? usd : c === "eur" ? usd * rates.eur : usd * rates.sek;
  const digits = Math.abs(v) < 100 ? 2 : 0;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return c === "usd" ? `$${s}` : c === "eur" ? `€${s}` : `${s} kr`;
}

const input = "h-11 w-full rounded-xl bg-muted/60 px-3.5 text-base tabular-nums outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring";
const small = "h-8 rounded-lg bg-muted/60 px-2.5 text-sm tabular-nums outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring";
const caption = "text-xs font-medium text-muted-foreground";

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T | null; options: { v: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl bg-muted p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" title={o.title} aria-pressed={o.v === value} onClick={() => onChange(o.v)} className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${o.v === value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Step({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`tabular-nums ${last ? "text-base font-semibold" : "text-sm"}`}>{value}</div>
      </div>
      {!last && <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />}
    </div>
  );
}

export function EarningsCalculator({ rates, initialGames }: { rates: Rates; initialGames: GameEstimate[] }) {
  const [amount, setAmount] = useState("1m");
  const [share, setShare] = useState("100");
  const [currency, setCurrency] = useState<Currency>("usd");
  const [rate, setRate] = useState(String(DEVEX_RATE));
  const [perVisit, setPerVisit] = useState("1.5");
  const [games, setGames] = useState(initialGames);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const robux = numberOf(amount);
  const sharePct = Math.min(100, numberOf(share));
  const devex = numberOf(rate);
  const mine = robux * (sharePct / 100);
  const usd = mine * devex;
  const others = CURRENCIES.filter((c) => c.v !== currency);
  const rpv = numberOf(perVisit);

  const add = async (g: PickedGame) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/tools/earnings?id=${g.id}`, { method: "POST" });
      const j = (await r.json()) as GameEstimate & { error?: string };
      if (!r.ok || j.error) throw new Error(j.error ?? "Could not load that game.");
      setGames((list) => [j, ...list.filter((x) => x.id !== j.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = (id: number) => {
    setGames((list) => list.filter((x) => x.id !== id));
    void fetch(`/api/tools/earnings?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <div className="grid gap-10">
      {/* Settings that apply to everything on the page */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="grid gap-1.5">
          <span className={caption}>Show money in</span>
          <Segmented label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
        </div>
        <div className="grid gap-1.5">
          <span className={caption}>Your share of the game</span>
          <div className="flex items-center gap-2">
            <Segmented label="Your share" value={SHARES.includes(sharePct) ? sharePct : null} onChange={(v) => setShare(String(v))} options={SHARES.map((s) => ({ v: s, label: `${s}%` }))} />
            <label className="relative">
              <input inputMode="decimal" aria-label="Your share in percent" value={share} onChange={(e) => setShare(e.target.value)} className={`${small} h-10 w-20 rounded-xl pr-7`} />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </label>
          </div>
        </div>
      </div>

      {/* Robux to money */}
      <section className="grid gap-4">
        <h2 className="text-base font-semibold tracking-tight">Robux to money</h2>
        <div className="grid gap-4 rounded-3xl bg-muted/30 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8 lg:p-6">
          <div className="grid content-start gap-4">
            <label className="grid gap-1.5">
              <span className={`${caption} flex justify-between gap-2`}>
                Robux
                {/[a-z]/i.test(amount) && robux > 0 && <span className="font-normal tabular-nums">= {whole(robux)}</span>}
              </span>
              <input inputMode="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1.5k, 1m, 1.2b" className={input} />
            </label>
            <p className="text-xs text-muted-foreground">Robux the game has earned, after Roblox&apos;s cut.</p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none hover:text-foreground">DevEx rate: {devex} USD per Robux</summary>
              <label className="mt-2 grid max-w-40 gap-1">
                USD per Robux
                <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={small} />
              </label>
            </details>
          </div>

          <div className="grid content-start gap-4">
            <div>
              <div className={caption}>{sharePct < 100 ? `Your ${sharePct}% in real money` : "In real money"}</div>
              <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{money(usd, currency, rates)}</div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 text-sm text-muted-foreground tabular-nums">
                {others.map((c) => (
                  <span key={c.v}>{money(usd, c.v, rates)}</span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 pt-4">
              <Step label="Earned" value={robuxText(robux)} />
              {sharePct < 100 && <Step label={`Your ${sharePct}%`} value={robuxText(mine)} />}
              <Step label="Through DevEx" value={money(usd, "usd", rates)} last />
            </div>
            <p className="text-xs text-muted-foreground">
              {mine > 0 && mine < DEVEX_MINIMUM ? `Below the cash-out minimum of ${whole(DEVEX_MINIMUM)} earned Robux. ` : ""}
              Before tax and payment fees.{rates.date ? ` Exchange rates from the European Central Bank, ${rates.date}.` : ""}
            </p>
          </div>
        </div>
      </section>

      {/* Games */}
      <section className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">What do these games earn?</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">A rough range from each game&apos;s visits. Games you add stay on this list.</p>
          </div>
          <div className="grid gap-1.5">
            <span className={caption}>Robux earned per visit</span>
            <div className="flex items-center gap-2">
              <Segmented label="Robux earned per visit" value={PER_VISIT.find((p) => p.v === rpv)?.v ?? null} onChange={(v) => setPerVisit(String(v))} options={PER_VISIT.map((p) => ({ v: p.v, label: `${p.label} ${p.v}`, title: p.help }))} />
              <input inputMode="decimal" aria-label="Robux earned per visit" value={perVisit} onChange={(e) => setPerVisit(e.target.value)} className={`${small} h-10 w-20 rounded-xl`} />
            </div>
          </div>
        </div>

        <GamePicker name="game" placeholder="Add a game: type its name" onPick={add} className="max-w-md" />
        {busy && <p className="text-sm text-muted-foreground">Adding…</p>}
        {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

        {games.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No games yet. Add one above to see roughly what it earns.</p>
        ) : (
          <div className="grid gap-2">
            {games.map((g) => {
              const day = g.visitsPerDay == null ? null : g.visitsPerDay * rpv * (sharePct / 100);
              return (
                <div key={g.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 rounded-2xl bg-muted/30 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_repeat(3,minmax(6.5rem,auto))_auto]">
                  {g.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.icon} alt="" className="size-12 rounded-xl bg-muted object-cover" />
                  ) : (
                    <span className="size-12 rounded-xl bg-muted" />
                  )}
                  <div className="min-w-0">
                    <Link href={`/games/${g.id}`} className="block truncate text-sm font-medium hover:underline">
                      {g.name}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground" title={g.basis}>
                      {whole(g.playing)} playing · {g.visitsPerDay != null ? `${whole(g.visitsPerDay)} visits a day` : "visits not measured yet"}
                    </div>
                  </div>
                  <button type="button" onClick={() => remove(g.id)} aria-label={`Remove ${g.name}`} className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:order-last">
                    <X className="size-4" />
                  </button>
                  {day == null ? (
                    <p className="col-span-3 text-xs text-muted-foreground">The tracker needs a few hours of readings before it can measure this game&apos;s visits. Check back later.</p>
                  ) : (
                    <>
                      <div className="col-span-3 grid grid-cols-3 gap-x-4 sm:contents">
                        <div className="sm:text-right">
                          <div className="text-xs text-muted-foreground">Robux a day</div>
                          <div className="text-sm tabular-nums">{robuxText(day)}</div>
                        </div>
                        <div className="sm:text-right">
                          <div className="text-xs text-muted-foreground">A day</div>
                          <div className="text-sm tabular-nums">{money(day * devex, currency, rates)}</div>
                        </div>
                        <div className="sm:text-right">
                          <div className="text-xs text-muted-foreground">A month</div>
                          <div className="text-base font-semibold tabular-nums">{money(day * devex * 30, currency, rates)}</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Visits are measured by the tracker. What a visit is worth is not public, so Low, Typical and Strong are assumptions, not measurements; for a real figure, divide Revenue by Visits on one of your own games in My games and type it in.
          {sharePct < 100 ? ` Amounts show your ${sharePct}% share.` : ""}
        </p>
      </section>
    </div>
  );
}
