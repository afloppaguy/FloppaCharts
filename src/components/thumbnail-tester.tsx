"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, ImagePlus, Shuffle, ThumbsUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";

type Tile = { id: number | "mine"; name: string; image: string; playing: number; like: number | null };
type Kind = "icon" | "wide";
type Device = "desktop" | "phone";

const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", o.value === value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Drop in a thumbnail or icon and see it sitting at a random spot among
 * popular Roblox games' artwork, at the size players actually see it.
 * The image never leaves this browser.
 */
export function ThumbnailTester() {
  const [mine, setMine] = useState<string | null>(null);
  const [title, setTitle] = useState("Your game");
  const [kind, setKind] = useState<Kind>("icon");
  const [device, setDevice] = useState<Device>("desktop");
  const [squint, setSquint] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [slot, setSlot] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async (k: Kind) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tools/tiles?kind=${k}`);
      if (!res.ok) throw new Error(res.status === 429 ? "Slow down a little and try again." : "Could not load other games' artwork.");
      const d = (await res.json()) as { tiles: Tile[] };
      setTiles(d.tiles);
      setSlot(Math.floor(Math.random() * Math.min(d.tiles.length, 18)));
      setReveal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetching the surrounding artwork when the shape changes is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(kind);
  }, [kind, load]);

  function take(file: File | undefined | null) {
    if (!file || !file.type.startsWith("image/")) return;
    setMine((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setReveal(false);
  }

  // Paste an image straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => take([...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/")));
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const shown = useMemo<Tile[]>(() => {
    const count = device === "phone" ? (kind === "wide" ? 8 : 12) : kind === "wide" ? 15 : 24;
    const others = tiles.slice(0, count - (mine ? 1 : 0));
    if (!mine) return others;
    const at = Math.min(slot, others.length);
    return [...others.slice(0, at), { id: "mine", name: title || "Your game", image: mine, playing: 12400, like: 92 }, ...others.slice(at)];
  }, [tiles, mine, slot, title, kind, device]);

  const cols = device === "phone" ? (kind === "wide" ? "grid-cols-2" : "grid-cols-3") : kind === "wide" ? "grid-cols-5" : "grid-cols-8";

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ImagePlus className="size-4" /> {mine ? "Change image" : "Choose image"}
        </button>
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => take(e.target.files?.[0])} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          aria-label="Game title"
          placeholder="Game title"
          className="h-8 w-48 rounded-lg bg-muted/60 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Segmented label="Artwork shape" value={kind} onChange={setKind} options={[{ value: "icon", label: "Icon (square)" }, { value: "wide", label: "Thumbnail (16:9)" }]} />
        <Segmented label="Screen" value={device} onChange={setDevice} options={[{ value: "desktop", label: "Desktop" }, { value: "phone", label: "Phone" }]} />
        <button
          type="button"
          aria-pressed={squint}
          onClick={() => setSquint((s) => !s)}
          title="Blurs the page slightly, like a quick glance. If yours still stands out, it reads well."
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", squint ? "bg-muted text-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground")}
        >
          <Eye className="size-4" /> Squint test
        </button>
        <button
          type="button"
          onClick={() => load(kind)}
          disabled={loading}
          title="New games around it and a new position"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <Shuffle className="size-4" /> Shuffle
        </button>
        {mine && (
          <button type="button" onClick={() => setReveal((r) => !r)} className="ml-auto h-8 rounded-lg px-2.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {reveal ? "Hide outline" : "Where is mine?"}
          </button>
        )}
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files?.[0]);
        }}
        className={cn("rounded-2xl p-4 transition-colors sm:p-6", dragging ? "bg-sky-500/10 ring-2 ring-sky-500" : "bg-[#191b1d]")}
      >
        {!mine && (
          <div className="mb-5 rounded-xl border border-dashed border-white/15 px-4 py-6 text-center text-sm text-white/60">
            Drop your thumbnail or icon anywhere here, paste it, or use Choose image. It stays in your browser and is not uploaded.
          </div>
        )}
        <div className={cn("mx-auto transition-[max-width,filter]", device === "phone" ? "max-w-[24rem]" : "max-w-none", squint && "blur-[2.5px]")}>
          <div className={cn("grid gap-x-3 gap-y-5", cols)}>
            {shown.map((t) => (
              <div key={t.id} className={cn("min-w-0 rounded-lg", t.id === "mine" && reveal && "outline outline-2 outline-offset-4 outline-sky-400")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.image} alt="" className={cn("w-full rounded-lg bg-white/5 object-cover", kind === "wide" ? "aspect-video" : "aspect-square")} />
                <div className="mt-1.5 line-clamp-2 text-[13px] leading-tight font-medium text-white">{t.name}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-white/55">
                  {t.like != null && (
                    <span className="inline-flex items-center gap-0.5">
                      <ThumbsUp className="size-2.5" /> {t.like}%
                    </span>
                  )}
                  <span className="inline-flex items-center gap-0.5">
                    <Users className="size-2.5" /> {compact(t.playing)}
                  </span>
                </div>
              </div>
            ))}
            {loading && !shown.length && Array.from({ length: 12 }, (_, i) => <div key={i} className={cn("animate-pulse rounded-lg bg-white/5", kind === "wide" ? "aspect-video" : "aspect-square")} />)}
          </div>
        </div>
      </div>

      <ul className="grid gap-1 text-xs text-muted-foreground">
        <li>Shuffle a few times. If you have to hunt for yours, players scrolling past will not see it either.</li>
        <li>Turn on Squint test: strong thumbnails keep one clear shape and one or two colours when blurred.</li>
        <li>Check Phone as well. Most Roblox players are on phones, where each tile is much smaller and small text disappears.</li>
      </ul>
    </div>
  );
}
