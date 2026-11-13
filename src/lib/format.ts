import { nowMs } from "./clock";

export function num(n: number | null | undefined): string {
  if (n == null) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
  return n.toLocaleString("en-US");
}

export function age(ts: number | null | undefined): string {
  if (!ts) return "–";
  const d = (nowMs() / 1000 - ts) / 86400;
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`;
  if (d < 60) return `${Math.round(d)}d`;
  if (d < 730) return `${Math.round(d / 30.4)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "never";
  const s = nowMs() / 1000 - ts;
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function likePct(up: number, down: number): number | null {
  const t = up + down;
  return t >= 5 ? Math.round((up / t) * 100) : null;
}

/** Growth against a baseline: percent when the baseline is big enough to mean something. */
export function growth(playing: number, base: number): { text: string; up: boolean; flat: boolean } {
  const diff = playing - base;
  if (diff === 0) return { text: "0%", up: false, flat: true };
  const sign = diff > 0 ? "+" : "−";
  const text = base >= 10 ? `${sign}${num(Math.round((Math.abs(diff) / base) * 100))}%` : `${sign}${num(Math.abs(diff))}`;
  return { text, up: diff > 0, flat: false };
}
