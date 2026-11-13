"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { refreshBriefing, runAnalysis, runGapFinder, setAutoTagAction, setModelAction, tagGameAction, tagRisingAction } from "@/app/actions";

type Result = { ok: true; message?: string } | { ok: false; message: string };

function AiButton({ label, busy, action, variant = "outline", title }: { label: string; busy: string; action: () => Promise<Result>; variant?: "outline" | "ghost" | "default"; title?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={pending}
      title={title}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (r.ok) toast.success(r.message ?? "Done");
          else toast.error(r.message);
        })
      }
    >
      <Sparkles />
      {pending ? busy : label}
    </Button>
  );
}

export function ModelPicker({ models, current }: { models: { id: string; label: string; blurb: string; input: number; output: number }[]; current: string }) {
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Model">
      {models.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={m.id === value}
          disabled={pending}
          onClick={() => {
            setValue(m.id);
            start(() => setModelAction(m.id));
          }}
          className={`rounded-xl px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${m.id === value ? "bg-foreground text-background" : "bg-muted/50 hover:bg-muted"}`}
        >
          <div className="text-sm font-medium">{m.label}</div>
          <div className={`text-xs ${m.id === value ? "opacity-70" : "text-muted-foreground"}`}>{m.blurb}</div>
          <div className={`mt-1 text-xs tabular-nums ${m.id === value ? "opacity-70" : "text-muted-foreground"}`}>
            ${m.input} in · ${m.output} out per 1M tokens
          </div>
        </button>
      ))}
    </div>
  );
}

export function BriefingButton({ label }: { label: string }) {
  return <AiButton label={label} busy="Writing…" variant="ghost" action={refreshBriefing} title="Writes a fresh briefing from the latest data. Uses Haiku; costs about a cent." />;
}

export function GapFinderButton({ hasRun }: { hasRun: boolean }) {
  return <AiButton label={hasRun ? "Search again" : "Find gaps"} busy="Scanning niches…" variant="default" action={runGapFinder} title="Claude scans every niche for demand with thin or weak supply and proposes a concept for each gap" />;
}

export function AutoTagToggle({ on }: { on: boolean }) {
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={pending}
      onClick={() => {
        setValue(!value);
        start(() => setAutoTagAction(!value));
      }}
      className={`relative h-6 w-10 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${value ? "bg-sky-500" : "bg-muted"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${value ? "left-[1.125rem]" : "left-0.5"}`} />
    </button>
  );
}

export function TagRisingButton() {
  return <AiButton label="Tag rising games with AI" busy="Tagging…" action={tagRisingAction} title="Tags up to 40 untagged rising games with theme and mechanic. Uses Haiku; costs well under a cent." />;
}

export function TagGameButton({ id }: { id: number }) {
  return <AiButton label="Tag with AI" busy="Tagging…" variant="ghost" action={() => tagGameAction(id)} title="Adds theme and mechanic tags from the title and description" />;
}

export function AnalyzeButton({ id, hasRun }: { id: number; hasRun: boolean }) {
  return <AiButton label={hasRun ? "Re-check with AI" : "Check for choke-points"} busy="Reading the numbers…" variant="default" action={() => runAnalysis(id)} title="Claude reads this game's analytics and reports where players or revenue are being lost" />;
}
