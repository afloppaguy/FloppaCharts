"use client";

import { useRef, useState } from "react";
import { cn } from "cn";
import { compactNumber } from "@/lib/metric-format";

export type PickedGame = { id: number; name: string; playing: number; creator: string | null; tracked: boolean; icon: string | null };

/**
 * A text box that finds a game by name. Type a few letters, pick from the
 * list. A pasted Roblox link or ID still works. Inside a form it submits as
 * `name`: "universe:<id>" for a picked game, otherwise the typed text.
 */
export function GamePicker({
  name = "ref",
  placeholder = "Type a game's name",
  className,
  required,
  onPick,
  submitOnPick = false,
}: {
  name?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  onPick?: (g: PickedGame) => void;
  submitOnPick?: boolean;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<PickedGame | null>(null);
  const [results, setResults] = useState<PickedGame[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const hidden = useRef<HTMLInputElement>(null);

  const search = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    const term = value.trim();
    // Links and IDs go straight through; there is nothing to look up.
    if (term.length < 2 || /^\d+$/.test(term) || /roblox\.com/i.test(term)) {
      setResults([]);
      setOpen(false);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/game-search?q=${encodeURIComponent(term)}`);
        const j = (await r.json()) as { games?: PickedGame[] };
        if (mine !== seq.current) return;
        setResults(j.games ?? []);
        setActive(0);
        setOpen(true);
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 220);
  };

  const choose = (g: PickedGame) => {
    setPicked(g);
    setText(g.name);
    setOpen(false);
    onPick?.(g);
    if (submitOnPick && hidden.current) {
      hidden.current.value = `universe:${g.id}`;
      hidden.current.form?.requestSubmit();
    }
  };

  return (
    <div className={cn("relative", className)}>
      <input type="hidden" ref={hidden} name={name} value={picked ? `universe:${picked.id}` : text.trim()} readOnly />
      <input
        value={text}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="game-picker-list"
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setPicked(null);
          search(e.target.value);
        }}
        onFocus={() => results.length > 0 && !picked && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + results.length) % results.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="h-8 w-full rounded-lg bg-muted/60 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
      {open && (
        <ul id="game-picker-list" role="listbox" className="absolute top-full left-0 z-50 mt-1 max-h-80 w-full min-w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl">
          {results.length === 0 && <li className="px-2.5 py-2 text-xs text-muted-foreground">{busy ? "Searching…" : "No game found. Paste its Roblox link instead."}</li>}
          {results.map((g, i) => (
            <li key={g.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(g)}
                onMouseEnter={() => setActive(i)}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left", i === active && "bg-muted")}
              >
                {g.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.icon} alt="" className="size-8 shrink-0 rounded-md bg-muted object-cover" />
                ) : (
                  <span className="size-8 shrink-0 rounded-md bg-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{g.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {compactNumber(g.playing)} playing{g.creator ? ` · ${g.creator}` : ""}
                    {g.tracked ? "" : " · not tracked yet"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
