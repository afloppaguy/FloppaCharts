"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChartLine, Compass, Eye, GitCompareArrows, Hash, History, Home, Lightbulb, Plus, Search, Settings, Shapes, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Suggest = {
  games: { id: number; name: string; playing: number; genre: string | null; icon: string | null }[];
  keywords: { term: string; games: number; hot: number }[];
  ideas: { id: number; title: string; grade: string | null }[];
};
type Item = { key: string; label: string; hint?: string; href: string; icon?: React.ReactNode; img?: string | null };

const PAGES: { label: string; href: string; icon: typeof Home; words: string }[] = [
  { label: "Home", href: "/", icon: Home, words: "home start feeds" },
  { label: "Explore", href: "/games", icon: Compass, words: "explore games browse" },
  { label: "Niches", href: "/niches", icon: Shapes, words: "niches themes genres keywords" },
  { label: "Gap finder", href: "/gaps", icon: Sparkles, words: "gaps opportunities ai concepts" },
  { label: "Compare", href: "/compare", icon: GitCompareArrows, words: "compare versus" },
  { label: "Watchlist", href: "/watchlist", icon: Eye, words: "watchlist watching" },
  { label: "Alerts", href: "/alerts", icon: Bell, words: "alerts notifications" },
  { label: "Ideas", href: "/ideas", icon: Lightbulb, words: "ideas chat conversations" },
  { label: "New idea", href: "/ideas?new=1", icon: Plus, words: "new idea chat ask grade" },
  { label: "My games", href: "/my-games", icon: ChartLine, words: "my games analytics" },
  { label: "Thumbnail tester", href: "/tools/thumbnail", icon: Sparkles, words: "tools thumbnail icon tester readability" },
  { label: "Activity", href: "/activity", icon: History, words: "activity edits undo" },
  { label: "Settings", href: "/settings", icon: Settings, words: "settings key budget model" },
];

const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(0) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));

/** Ctrl+K (or Cmd+K): jump to any page, game, keyword or saved idea from anywhere. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [data, setData] = useState<Suggest>({ games: [], keywords: [], ideas: [] });
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Start clean each time it opens.
        setText("");
        setActive(0);
        setData({ games: [], keywords: [], ideas: [] });
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = text.trim();
    if (!open || term.length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(term)}`);
        if (res.ok && mine === seq.current) setData((await res.json()) as Suggest);
      } catch {
        // pages still work without suggestions
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [text, open]);

  const items = useMemo<Item[]>(() => {
    const term = text.trim().toLowerCase();
    const pages = PAGES.filter((p) => !term || p.label.toLowerCase().includes(term) || p.words.includes(term)).map((p) => ({ key: `p${p.href}`, label: p.label, href: p.href, hint: "Page", icon: <p.icon className="size-4" /> }));
    if (term.length < 2) return pages;
    return [
      ...pages.slice(0, 3),
      ...data.games.map((g) => ({ key: `g${g.id}`, label: g.name, href: `/games/${g.id}`, hint: `${compact(g.playing)} playing`, img: g.icon })),
      ...data.keywords.map((k) => ({ key: `k${k.term}`, label: k.term, href: `/games?q=${encodeURIComponent(k.term)}&min=20`, hint: `${k.games} games`, icon: <Hash className="size-4" /> })),
      ...data.ideas.map((c) => ({ key: `i${c.id}`, label: c.title, href: `/ideas/${c.id}`, hint: c.grade ? `Idea · ${c.grade}` : "Idea", icon: <Lightbulb className="size-4" /> })),
      { key: "search", label: `Search games for "${text.trim()}"`, href: `/games?q=${encodeURIComponent(text.trim())}&min=0`, hint: "Explore", icon: <Search className="size-4" /> },
      { key: "ask", label: `Ask the AI about "${text.trim()}"`, href: `/ideas?new=1&prompt=${encodeURIComponent(text.trim())}`, hint: "Ideas", icon: <Sparkles className="size-4" /> },
    ];
  }, [text, data]);

  if (!open) return null;
  const go = (item: Item) => {
    setOpen(false);
    router.push(item.href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Quick search">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-popover shadow-2xl ring-1 ring-foreground/10" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-border/60 px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={text}
            aria-label="Search games, keywords, ideas and pages"
            placeholder="Search games, keywords, ideas, pages…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && items[active]) {
                e.preventDefault();
                go(items[active]);
              }
            }}
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item)}
              className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm", i === active && "bg-muted")}
            >
              {item.img !== undefined ? (
                item.img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.img} alt="" className="size-7 shrink-0 rounded-md bg-muted object-cover" />
                ) : (
                  <span className="size-7 shrink-0 rounded-md bg-muted" />
                )
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">{item.icon}</span>
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
