import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getPresets } from "@/lib/queries";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </header>
  );
}

export function Section({ title, hint, href, children }: { title: string; hint?: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="grid content-start gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </div>
        {href ? (
          <Link href={href} className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            View all <ArrowRight className="size-3" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Saved filter shortcuts. The active one is highlighted when the URL matches it exactly. */
export async function Presets({ current }: { current?: string }) {
  const presets = await getPresets();
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((p) => {
        const qs = new URLSearchParams(JSON.parse(p.filters) as Record<string, string>);
        qs.sort();
        const on = current === qs.toString();
        return (
          <Link
            key={p.id}
            href={`/games?${qs.toString()}`}
            title={p.description ?? ""}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${on ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {p.name}
          </Link>
        );
      })}
    </div>
  );
}
