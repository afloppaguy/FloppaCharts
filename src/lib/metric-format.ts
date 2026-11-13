// Number formatting shared by server pages and browser components.

export type MetricFormat = "int" | "pct" | "min" | "robux" | "fps" | "dec";

export const compactNumber = (n: number) =>
  Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(0) + "K" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n * 10) / 10);

export function fmtMetric(v: number | null, f: MetricFormat): string {
  if (v == null) return "–";
  switch (f) {
    case "pct":
      return `${v.toFixed(v < 10 ? 1 : 0)}%`;
    case "min":
      return `${v.toFixed(1)} min`;
    case "robux":
      return `${compactNumber(Math.round(v))} R$`;
    case "fps":
      return v.toFixed(0);
    case "dec":
      return v.toFixed(2);
    default:
      return compactNumber(Math.round(v));
  }
}
