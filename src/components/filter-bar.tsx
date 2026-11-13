"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";

const STEPS = [0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 50000];
const stepOf = (min: number) => {
  const i = STEPS.findIndex((s) => s >= min);
  return i < 0 ? STEPS.length - 1 : i;
};
const first = (v: number | readonly number[]) => (typeof v === "number" ? v : v[0]);
const pill =
  "h-8 rounded-lg bg-muted/60 px-2.5 text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&>option]:bg-popover";

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select aria-label={label} className={`${pill} ${value ? "" : "text-muted-foreground"}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

export function FilterBar({ genres, sorts, defaultMin }: { genres: string[]; sorts: Record<string, string>; defaultMin: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [text, setText] = useState(sp.get("q") ?? "");
  // While dragging, the slider shows the dragged value; once the URL catches up it follows the URL again.
  const spMin = sp.get("min");
  const [drag, setDrag] = useState<{ step: number; spMin: string | null } | null>(null);
  const step = drag && drag.spMin === spMin ? drag.step : stepOf(Number(spMin ?? defaultMin));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    next.delete("error");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const active = ["q", "min", "maxAge", "updatedWithin", "genre", "sub", "minLike", "sort", "chart", "tag"].some((k) => sp.get(k));
  const chart = sp.get("chart");
  const tag = sp.get("tag");
  const sub = sp.get("sub");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-label="Search titles, descriptions, creators and tags; separate several words with commas"
          title="Matches titles, descriptions, creators and tags. Separate several words with commas to find games matching any of them."
          value={text}
          placeholder="Search: smash, throw, egg"
          className={`${pill} w-64 pl-8 placeholder:text-muted-foreground`}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => set({ q: v }), 300);
          }}
        />
      </div>
      <div className={`${pill} flex items-center gap-3`}>
        <span className="w-28 text-sm whitespace-nowrap tabular-nums">
          {STEPS[step].toLocaleString("en-US")}+ <span className="text-muted-foreground">players</span>
        </span>
        <Slider
          aria-label="Minimum players"
          className="w-28"
          min={0}
          max={STEPS.length - 1}
          step={1}
          value={[step]}
          onValueChange={(v) => setDrag({ step: first(v), spMin })}
          onValueCommitted={(v) => set({ min: String(STEPS[first(v)]) })}
        />
      </div>
      <Select label="Age" value={sp.get("maxAge") ?? ""} onChange={(v) => set({ maxAge: v })}>
        <option value="">Any age</option>
        <option value="7">Under 7 days</option>
        <option value="30">Under 30 days</option>
        <option value="60">Under 60 days</option>
        <option value="90">Under 90 days</option>
        <option value="365">Under 1 year</option>
      </Select>
      <Select label="Last updated" value={sp.get("updatedWithin") ?? ""} onChange={(v) => set({ updatedWithin: v })}>
        <option value="">Any update date</option>
        <option value="1">Updated today</option>
        <option value="7">Updated this week</option>
        <option value="30">Updated this month</option>
      </Select>
      <Select label="Genre" value={sp.get("genre") ?? ""} onChange={(v) => set({ genre: v })}>
        <option value="">All genres</option>
        {genres.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </Select>
      <Select label="Like ratio" value={sp.get("minLike") ?? ""} onChange={(v) => set({ minLike: v })}>
        <option value="">Any rating</option>
        <option value="70">70%+ likes</option>
        <option value="80">80%+ likes</option>
        <option value="90">90%+ likes</option>
      </Select>
      {chart && (
        <button type="button" className={`${pill} flex items-center gap-1.5 capitalize`} onClick={() => set({ chart: null })}>
          {chart.replace(/-/g, " ")} <X className="size-3" />
        </button>
      )}
      {sub && (
        <button type="button" className={`${pill} flex items-center gap-1.5`} onClick={() => set({ sub: null })}>
          {sub} <X className="size-3" />
        </button>
      )}
      {tag && (
        <button type="button" className={`${pill} flex items-center gap-1.5`} onClick={() => set({ tag: null })}>
          #{tag} <X className="size-3" />
        </button>
      )}
      {active && (
        <button
          type="button"
          className="h-8 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setText("");
            router.replace(sp.get("watch") ? `${pathname}?watch=1` : pathname, { scroll: false });
          }}
        >
          Clear
        </button>
      )}
      <div className="ml-auto">
        <Select label="Sort by" value={sp.get("sort") ?? "rise"} onChange={(v) => set({ sort: v })}>
          {Object.entries(sorts).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
