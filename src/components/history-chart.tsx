"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type Point = { ts: number; playing: number | null; visits: number | null; like: number | null };
const RANGES: Record<string, number> = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, "1y": 365 * 86400, all: Infinity };
const METRICS = { playing: "Players", visits: "Total visits", like: "Like ratio %" } as const;
type Metric = keyof typeof METRICS;

const compact = (n: number) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));

export function HistoryChart({ points, nowTs }: { points: Point[]; nowTs: number }) {
  const span = points.length ? nowTs - points[0].ts : 0;
  const [range, setRange] = useState(span > 40 * 86400 ? "30d" : "all");
  const [metric, setMetric] = useState<Metric>("playing");

  const data = useMemo(() => {
    const cut = nowTs - RANGES[range];
    return points.filter((p) => p.ts >= cut && p[metric] != null);
  }, [points, range, metric, nowTs]);

  const config = { [metric]: { label: METRICS[metric], color: "var(--chart-1)" } } satisfies ChartConfig;
  const short = data.length > 1 && data[data.length - 1].ts - data[0].ts < 3 * 86400;
  const tick = (ts: number) => {
    const d = new Date(ts * 1000);
    return short ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
          <TabsList>
            {Object.entries(METRICS).map(([k, v]) => (
              <TabsTrigger key={k} value={k}>
                {v}
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
      {data.length < 2 ? (
        <div className="flex h-72 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          Not enough history in this range yet.
        </div>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <AreaChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
            <defs>
              <linearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} tickLine={false} axisLine={false} minTickGap={48} />
            <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={48} domain={metric === "playing" ? [0, "auto"] : ["auto", "auto"]} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const ts = payload?.[0]?.payload?.ts as number | undefined;
                    return ts ? new Date(ts * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
                  }}
                />
              }
            />
            <Area dataKey={metric} type="monotone" stroke="var(--chart-1)" strokeWidth={1.5} fill="url(#historyFill)" isAnimationActive={false} dot={false} />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}
