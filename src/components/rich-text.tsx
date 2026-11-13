"use client";

import { Children, isValidElement, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type Card = { id: number; name: string; playing: number; icon: string | null; like: number | null; growth: { text: string; up: boolean } | null; pace: number | null };

const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(0) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));
const cardCache = new Map<string, Promise<Card[]>>();

function loadCards(ids: number[]): Promise<Card[]> {
  const key = ids.join(",");
  let p = cardCache.get(key);
  if (!p) {
    p = fetch(`/api/cards?ids=${key}`)
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d: { games: Card[] }) => d.games)
      .catch(() => []);
    cardCache.set(key, p);
  }
  return p;
}

/** A row of clickable game cards with icons and live numbers. */
export function GameStrip({ ids }: { ids: number[] }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    loadCards(ids).then((c) => live && setCards(c));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (cards && !cards.length) return null;
  return (
    <div className="not-prose grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
      {(cards ?? ids.map((id) => ({ id }) as Card)).map((g) => (
        <Link key={g.id} href={`/games/${g.id}`} className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {g.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={g.icon} alt="" className="aspect-square w-full rounded-xl bg-muted object-cover transition group-hover:brightness-110" loading="lazy" />
          ) : (
            <div className={cn("aspect-square w-full rounded-xl bg-muted", !cards && "animate-pulse")} />
          )}
          {cards && (
            <>
              <div className="mt-1.5 truncate text-xs font-medium" title={g.name}>
                {g.name}
              </div>
              <div className="flex items-baseline justify-between gap-1 text-[11px] text-muted-foreground">
                <span className="tabular-nums">{compact(g.playing)}</span>
                {g.growth ? <span className={cn("tabular-nums", g.growth.up ? "text-emerald-400" : "text-rose-400")}>{g.growth.text}</span> : g.like != null ? <span className="tabular-nums">{g.like}%</span> : null}
              </div>
            </>
          )}
        </Link>
      ))}
    </div>
  );
}

const GAMES_LINE = /^::games\s+([\d\s,]+)$/;

function textOf(node: React.ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement<{ children?: React.ReactNode }>(c) ? textOf(c.props.children) : ""))
    .join("");
}

/**
 * Markdown from the AI. A line of the form "::games 123, 456" becomes a row of
 * game cards; wide tables scroll inside their own box.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  // The AI sometimes puts "::games ..." at the end of a sentence or directly
  // under one; give it a paragraph of its own so it becomes a row of cards.
  const prepared = text.replace(/[ \t]*\n?[ \t]*(::games[ \t]+\d[\d ,]*\d)[ \t]*/g, "\n\n$1\n\n");
  return (
    <div className={cn("prose-chat min-w-0 text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => {
            const m = textOf(children).trim().match(GAMES_LINE);
            if (!m) return <p>{children}</p>;
            const ids = m[1].split(/[\s,]+/).map(Number).filter((n) => n > 0);
            return <GameStrip ids={ids.slice(0, 8)} />;
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) =>
            href?.startsWith("/") ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
