"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { compactNumber, fmtMetric } from "@/lib/metric-format";
import { cn } from "@/lib/utils";

export type ExplorerMetric = {
  id: string;
  label: string;
  group: string;
  format: "int" | "pct" | "min" | "robux" | "fps" | "dec";
  goodWhen: "up" | "down";
  help: string;
  current: number | null;
  previous: number | null;
  changePct: number | null;
  series: { t: number; v: number }[];
  prevSeries: { t: number; v: number }[];
  error?: string;
};

const compact = compactNumber;

function Delta({ m, className }: { m: ExplorerMetric; className?: string }) {
  if (m.changePct == null) return null;
  const meaningful = Math.abs(m.changePct) >= 2;
  const good = meaningful ? m.changePct > 0 === (m.goodWhen === "up") : null;
  return (
    <span className={cn("tabular-nums", good == null ? "text-muted-foreground" : good ? "text-emerald-400" : "text-rose-400", className)}>
      {m.changePct > 0 ? "+" : m.changePct < 0 ? "−" : ""}
      {Math.abs(m.changePct).toFixed(Math.abs(m.changePct) < 10 ? 1 : 0)}%
    </span>
  );
}

function Spark({ points }: { points: { v: number }[] }) {
  if (points.length < 2) return <div className="h-6" />;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (vals.length - 1)) * 100).toFixed(1)},${(22 - ((v - min) / span) * 20).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <path d={d} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="stroke-current opacity-50" />
    </svg>
  );
}

/**
 * Every metric as a card; click one to see it as a large chart with the
 * previous period drawn behind it for comparison.
 */
export function MetricExplorer({ metrics, days }: { metrics: ExplorerMetric[]; days: number }) {
  const groups = useMemo(() => [...new Set(metrics.map((m) => m.group))], [metrics]);
  const [selected, setSelected] = useState(metrics.find((m) => m.current != null)?.id ?? metrics[0]?.id);
  const m = metrics.find((x) => x.id === selected) ?? metrics[0];

  const data = useMemo(() => {
    if (!m) return [];
    // Line the previous period up day-for-day with the current one.
    const offset = m.prevSeries.length - m.series.length;
    return m.series.map((p, i) => ({ t: p.t, value: p.v, previous: m.prevSeries[i + offset]?.v ?? null }));
  }, [m]);

  if (!m) return null;
  const config = { value: { label: m.label, color: "var(--chart-1)" }, previous: { label: `Previous ${days} days`, color: "var(--muted-foreground)" } } satisfies ChartConfig;

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl bg-muted/30 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">{m.label}</div>
            <div className="mt-0.5 flex items-baseline gap-3">
              <span className="text-3xl font-semibold tracking-tight tabular-nums">{fmtMetric(m.current, m.format)}</span>
              <Delta m={m} className="text-sm" />
              {m.previous != null && <span className="text-xs text-muted-foreground">was {fmtMetric(m.previous, m.format)}</span>}
            </div>
          </div>
          <p className="max-w-sm text-right text-xs text-muted-foreground">{m.help}</p>
        </div>
        {data.length < 2 ? (
          <div className="mt-4 flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{m.error ? "Roblox did not return this metric for your game." : "No data in this period."}</div>
        ) : (
          <ChartContainer config={config} className="mt-4 aspect-auto h-64 w-full">
            <AreaChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
              <defs>
                <linearGradient id="explorerFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="t" tickFormatter={(t: number) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" })} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={44} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const t = payload?.[0]?.payload?.t as number | undefined;
                      return t ? new Date(t * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
                    }}
                  />
                }
              />
              <Line dataKey="previous" type="monotone" stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls />
              <Area dataKey="value" type="monotone" stroke="var(--chart-1)" strokeWidth={1.75} fill="url(#explorerFill)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        )}
        {m.prevSeries.length > 0 && <div className="mt-2 text-xs text-muted-foreground">Solid: last {days} days · Dashed: the {days} days before</div>}
      </div>

      {groups.map((group) => (
        <div key={group}>
          <div className="mb-2 text-xs font-medium text-muted-foreground">{group}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {metrics
              .filter((x) => x.group === group)
              .map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setSelected(x.id)}
                  aria-pressed={x.id === selected}
                  title={x.error ?? x.help}
                  className={cn(
                    "rounded-xl px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    x.id === selected ? "bg-muted ring-1 ring-foreground/15" : "bg-muted/30 hover:bg-muted/60",
                    x.current == null && "opacity-50",
                  )}
                >
                  <div className="truncate text-xs text-muted-foreground">{x.label}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-lg font-semibold tracking-tight tabular-nums">{fmtMetric(x.current, x.format)}</span>
                    <Delta m={x} className="text-xs" />
                  </div>
                  <Spark points={x.series} />
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Session drop-off: the share of sessions still going at each time mark. */
export function SurvivalChart({ curve }: { curve: { sec: number; pct: number }[] }) {
  const data = curve.filter((p) => p.sec <= 1800);
  const config = { pct: { label: "Still playing", color: "var(--chart-2)" } } satisfies ChartConfig;
  if (data.length < 2) return null;
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="survivalFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="sec" type="number" domain={[0, "dataMax"]} tickFormatter={(s: number) => (s < 60 ? `${s}s` : `${Math.round(s / 60)}m`)} tickLine={false} axisLine={false} ticks={[0, 60, 120, 300, 600, 900, 1200, 1800]} />
        <YAxis tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} width={40} domain={[0, 100]} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => `After ${(() => { const s = (payload?.[0]?.payload?.sec as number) ?? 0; return s < 60 ? `${s} seconds` : `${(s / 60).toFixed(1)} minutes`; })()}`} />} />
        <Area dataKey="pct" type="monotone" stroke="var(--chart-2)" strokeWidth={1.75} fill="url(#survivalFill)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}
