"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, History, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addTag, backfill, removeTag, saveNote, toggleWatch } from "@/app/actions";

export function WatchButton({ id, watched }: { id: number; watched: boolean }) {
  const [on, setOn] = useState(watched);
  const [pending, start] = useTransition();
  return (
    <Button
      variant={on ? "secondary" : "outline"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await toggleWatch(id, !on);
          if (r.ok) setOn(!on);
          else toast.error(r.message);
        })
      }
    >
      {on ? <EyeOff /> : <Eye />}
      {on ? "Watching" : "Watch"}
    </Button>
  );
}

export function BackfillButton({ id, done }: { id: number; done: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      title="Fetch this game's older history from its public Rolimons page"
      onClick={() =>
        start(async () => {
          const r = await backfill(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.message);
        })
      }
    >
      <History />
      {pending ? "Fetching history…" : done ? "Refresh older history" : "Get older history"}
    </Button>
  );
}

export function Notes({ id, initial }: { id: number; initial: string }) {
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Playtest notes: why does this game work? What would you borrow?"
        className="min-h-44 border-0 bg-muted/50 shadow-none"
      />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={pending || body === saved}
          onClick={() =>
            start(async () => {
              const r = await saveNote(id, body);
              if (r.ok) {
                setSaved(body);
                toast.success("Notes saved");
              } else toast.error(r.message);
            })
          }
        >
          {pending ? "Saving…" : "Save notes"}
        </Button>
        {body !== saved && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
      </div>
    </div>
  );
}

export function Tags({ id, tags }: { id: number; tags: { tag: string; src: string }[] }) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <Badge key={t.tag} variant="secondary" className="gap-1 font-normal" title={t.src === "ai" ? "Added by AI" : "Added by you"}>
          {t.tag}
          <button
            aria-label={`Remove tag ${t.tag}`}
            disabled={pending}
            onClick={() =>
              start(async () => {
                await removeTag(id, t.tag);
              })
            }
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          start(async () => {
            const r = await addTag(id, value);
            if (r.ok) setValue("");
            else toast.error(r.message);
          });
        }}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Add tag" className="h-6 w-28 text-xs" />
      </form>
    </div>
  );
}
