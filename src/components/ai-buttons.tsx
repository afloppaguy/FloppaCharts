"use client";

import { useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runAnalysis, tagGameAction, tagRisingAction } from "@/app/actions";

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

export function TagRisingButton() {
  return <AiButton label="Tag rising games with AI" busy="Tagging…" action={tagRisingAction} title="Tags up to 40 untagged rising games with theme and mechanic. Uses Haiku; costs well under a cent." />;
}

export function TagGameButton({ id }: { id: number }) {
  return <AiButton label="Tag with AI" busy="Tagging…" variant="ghost" action={() => tagGameAction(id)} title="Adds theme and mechanic tags from the title and description" />;
}

export function AnalyzeButton({ id, hasRun }: { id: number; hasRun: boolean }) {
  return <AiButton label={hasRun ? "Re-check with AI" : "Check for choke-points"} busy="Reading the numbers…" variant="default" action={() => runAnalysis(id)} title="Claude reads this game's analytics and reports where players or revenue are being lost" />;
}
