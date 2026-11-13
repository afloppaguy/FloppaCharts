"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Suggestions = { games: { id: number; name: string; playing: number; genre: string | null; icon: string | null }[]; keywords: { term: string; games: number; hot: number }[] };
type Item = { kind: "search"; label: string } | { kind: "keyword"; term: string; games: number; hot: number } | { kind: "game"; id: number; name: string; playing: number; genre: string | null; icon: string | null };

const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(0) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));

/**
 * Search field with a dropdown of suggestions: keywords from game titles and
 * matching games with their icons. Enter searches for what was typed; picking
 * a keyword searches for it; picking a game opens it. Several words can be
 * separated by commas.
 */
export function SearchBox({ initial, onSearch, className }: { initial: string; onSearch: (q: string) => void; className?: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Suggestions>({ games: [], keywords: [] });
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = text.split(",").pop()!.trim();
    if (term.length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(text)}`);
        if (res.ok && mine === seq.current) setData((await res.json()) as Suggestions);
      } catch {
        // suggestions are a nicety; typing keeps working without them
      }
    }, 140);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const typing = text.split(",").pop()!.trim();
  const before = text.includes(",") ? text.slice(0, text.lastIndexOf(",") + 1).trim() + " " : "";
  const show = open && typing.length >= 2;
  const items: Item[] = show ? [{ kind: "search", label: text.trim() }, ...data.keywords.map((k) => ({ kind: "keyword" as const, ...k })), ...data.games.map((g) => ({ kind: "game" as const, ...g }))] : [];

  function choose(item: Item) {
    setOpen(false);
    if (item.kind === "game") router.push(`/games/${item.id}`);
    else {
      const next = item.kind === "keyword" ? before + item.term : item.label;
      setText(next);
      onSearch(next);
    }
  }

  return (
    <div ref={box} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        role="combobox"
        aria-expanded={show}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        aria-label="Search titles, descriptions, creators and tags; separate several words with commas"
        value={text}
        placeholder="Search: smash, throw, egg"
        className="h-8 w-full rounded-lg bg-muted/60 pr-2.5 pl-8 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && items.length) {
            e.preventDefault();
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === "ArrowUp" && items.length) {
            e.preventDefault();
            setActive((a) => (a - 1 + items.length) % items.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (items[active]) choose(items[active]);
            else {
              setOpen(false);
              onSearch(text.trim());
            }
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {show && (
        <div id="search-suggestions" role="listbox" className="absolute top-full left-0 z-30 mt-1.5 w-[26rem] max-w-[90vw] overflow-hidden rounded-xl bg-popover p-1.5 text-sm shadow-xl ring-1 ring-foreground/10">
          {items.map((item, i) => (
            <button
              key={item.kind === "game" ? `g${item.id}` : item.kind === "keyword" ? `k${item.term}` : "search"}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left", i === active && "bg-muted")}
            >
              {item.kind === "search" ? (
                <>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                    <Search className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    Search for <span className="font-medium">{item.label}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">Enter</span>
                </>
              ) : item.kind === "keyword" ? (
                <>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                    <Hash className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate capitalize">{item.term}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.games} games{item.hot ? <span className="text-emerald-400"> · {item.hot} hot</span> : null}
                  </span>
                </>
              ) : (
                <>
                  {item.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.icon} alt="" className="size-7 shrink-0 rounded-md bg-muted object-cover" />
                  ) : (
                    <span className="size-7 shrink-0 rounded-md bg-muted" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}</span>
                    {item.genre && <span className="block truncate text-xs text-muted-foreground">{item.genre}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{compact(item.playing)} playing</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
