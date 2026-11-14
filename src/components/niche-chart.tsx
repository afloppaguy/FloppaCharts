"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { compactNumber } from "@/lib/metric-format";

export type NicheChartPoint = { ts: number; players: number; games: number; hot: number | null };

const RANGES: Record<string, number> = { "48h": 2 * 86400, "7d": 7 * 86400, "30d": 30 * 86400, all: Infinity };
const METRICS = {
  players: { label: "Players", help: "Players across every game in the group" },
  games: { label: "Games", help: "Games in the group with 20 or more players" },
  hot: { label: "Hot games", help: "Games growing 15%+ or on Roblox's trending charts" },
} as const;
type Metric = keyof typeof METRICS;

export function NicheChart({ points, nowTs }: { points: NicheChartPoint[]; nowTs: number }) {
  const [range, setRange] = useState("all");
  const [metric, setMetric] = useState<Metric>("players");

  const { rows, daily } = useMemo(() => {
    const cut = nowTs - RANGES[range];
    const pts = points.filter((p) => p.ts >= cut && p[metric] != null);
    const span = pts.length ? pts[pts.length - 1].ts - pts[0].ts : 0;
    // Past a few days, hourly points are mostly the daily cycle: show one average per day instead.
    if (span <= 4 * 86400) return { rows: pts.map((p) => ({ ts: p.ts, v: p[metric] as number })), daily: false };
    const days = new Map<number, { sum: number; n: number }>();
    for (const p of pts) {
      const d = Math.floor(p.ts / 86400) * 86400;
      const cur = days.get(d) ?? { sum: 0, n: 0 };
      cur.sum += p[metric] as number;
      cur.n++;
      days.set(d, cur);
    }
    const today = Math.floor(nowTs / 86400) * 86400;
    return { rows: [...days.entries()].filter(([d]) => d < today).sort((a, b) => a[0] - b[0]).map(([d, x]) => ({ ts: d, v: Math.round(x.sum / x.n) })), daily: true };
  }, [points, range, metric, nowTs]);

  const config = { v: { label: METRICS[metric].label, color: "var(--chart-1)" } } satisfies ChartConfig;
  const tick = (ts: number) => {
    const d = new Date(ts * 1000);
    return daily ? d.toLocaleDateString([], { month: "short", day: "numeric" }) : d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
          <TabsList>
            {(Object.keys(METRICS) as Metric[]).map((m) => (
              <TabsTrigger key={m} value={m} title={METRICS[m].help}>
                {METRICS[m].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs value={range} onValueChange={(v) => setRange(String(v))}>
          <TabsList>
            {Object.keys(RANGES).map((k) => (
              <TabsTrigger key={k} value={k}>
                {k === "all" ? "All" : k}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {rows.length < 2 ? (
        <div className="flex h-72 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">Not enough history in this range yet. A point is added every hour.</div>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <AreaChart data={rows} margin={{ left: 4, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} tickLine={false} axisLine={false} minTickGap={56} />
            <YAxis tickFormatter={compactNumber} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const ts = payload?.[0]?.payload?.ts as number | undefined;
                    return ts ? new Date(ts * 1000).toLocaleString([], daily ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }) : "";
                  }}
                />
              }
            />
            <Area dataKey="v" type="monotone" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.12} strokeWidth={1.75} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ChartContainer>
      )}
      <p className="text-xs text-muted-foreground">{daily ? "One point per day: the average across that day." : "One point per hour. Player counts rise and fall with the time of day; compare the same hours."}</p>
    </div>
  );
}
