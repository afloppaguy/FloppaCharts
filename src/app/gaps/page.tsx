import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { GapFinderButton } from "@/components/ai-buttons";
import { PageHeader } from "@/components/page-parts";
import { GameStrip } from "@/components/rich-text";
import { getApiKey, modelLabel } from "@/lib/ai";
import { ago } from "@/lib/format";
import { getGaps } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function GapsPage() {
  const [run, key] = await Promise.all([getGaps(), getApiKey()]);
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title="Gap finder" subtitle="Niches where players are showing up but the games are few, old or weak, each with one concept to investigate.">
        <div className="flex items-center gap-3">
          {run && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {ago(run.run_ts)}
              {run.model ? ` · ${modelLabel(run.model)}` : ""}
            </span>
          )}
          {key ? <GapFinderButton hasRun={!!run} /> : null}
        </div>
      </PageHeader>

      {!key ? (
        <p className="rounded-xl bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
          The gap finder needs a Claude API key.{" "}
          <Link href="/settings" className="text-foreground underline underline-offset-4">
            Add one in Settings
          </Link>
          .
        </p>
      ) : !run ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Press Find gaps to scan every niche. It uses the model chosen in Settings and takes under a minute.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {run.gaps.map((g, i) => (
            <article key={i} className="grid content-start gap-3 rounded-2xl bg-muted/30 p-5">
              <div>
                <div className="text-xs text-muted-foreground capitalize">{g.niche}</div>
                <h2 className="mt-0.5 text-lg font-semibold tracking-tight">{g.concept_name}</h2>
                <p className="mt-1 text-sm">{g.pitch}</p>
              </div>
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">The gap</dt>
                  <dd>{g.signal}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Why it fits</dt>
                  <dd>{g.why_it_fits}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Main risk</dt>
                  <dd className="text-muted-foreground">{g.risk}</dd>
                </div>
              </dl>
              {g.reference_ids.length > 0 && <GameStrip ids={g.reference_ids} />}
              <Link
                href={`/ideas?new=1&prompt=${encodeURIComponent(`Grade this idea from the gap finder and check it against the data.\n\n${g.concept_name}: ${g.pitch}\n\nNiche: ${g.niche}. ${g.signal}`)}`}
                className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-sm hover:bg-muted/70"
              >
                <MessageSquare className="size-3.5" /> Grade and discuss
              </Link>
            </article>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">These are leads from numbers and titles only. The AI has not played any of these games; treat each as something to check, not a prediction.</p>
    </div>
  );
}
