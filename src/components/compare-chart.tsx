"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type CompareSeries = { id: number; name: string; points: { ts: number; playing: number }[] };

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const RANGES: Record<string, number> = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, all: Infinity };
const compact = (n: number) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n)));

export function CompareChart({ series, nowTs }: { series: CompareSeries[]; nowTs: number }) {
  const [range, setRange] = useState("all");
  const [mode, setMode] = useState<"players" | "indexed">("players");

  const { rows, short } = useMemo(() => {
    const cut = nowTs - RANGES[range];
    const span = Math.min(RANGES[range], nowTs - Math.min(...series.flatMap((s) => s.points.map((p) => p.ts)), nowTs));
    // Put every game on a shared time grid so one hover shows all of them.
    const bucket = span <= 2 * 86400 ? 900 : span <= 14 * 86400 ? 3600 : 86400;
    const byTime = new Map<number, Record<string, number>>();
    for (const s of series) {
      const pts = s.points.filter((p) => p.ts >= cut);
      const base = pts.find((p) => p.playing > 0)?.playing ?? 1;
      for (const p of pts) {
        const t = Math.floor(p.ts / bucket) * bucket;
        const row = byTime.get(t) ?? { ts: t };
        row[`g${s.id}`] = mode === "indexed" ? Math.round((p.playing / base) * 1000) / 10 : p.playing;
        byTime.set(t, row);
      }
    }
    return { rows: [...byTime.values()].sort((a, b) => a.ts - b.ts), short: span <= 3 * 86400 };
  }, [series, range, mode, nowTs]);

  const config = Object.fromEntries(series.map((s, i) => [`g${s.id}`, { label: s.name, color: COLORS[i % COLORS.length] }])) satisfies ChartConfig;
  const tick = (ts: number) => {
    const d = new Date(ts * 1000);
    return short ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "players" | "indexed")}>
          <TabsList>
            <TabsTrigger value="players">Players</TabsTrigger>
            <TabsTrigger value="indexed" title="Each game starts at 100, so growth can be compared regardless of size">
              Growth (start = 100)
            </TabsTrigger>
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
        <div className="flex h-80 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">Not enough history in this range yet.</div>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-80 w-full">
          <LineChart data={rows} margin={{ left: 4, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} tickLine={false} axisLine={false} minTickGap={48} />
            <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={48} />
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
            {series.map((s, i) => (
              <Line key={s.id} dataKey={`g${s.id}`} type="monotone" stroke={COLORS[i % COLORS.length]} strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ChartContainer>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
