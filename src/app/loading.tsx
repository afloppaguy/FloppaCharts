// Shown the instant a link is clicked, while the next page's data loads.
export default function Loading() {
  return (
    <div className="mx-auto grid max-w-6xl gap-6" aria-busy="true" aria-label="Loading">
      <div className="grid gap-2">
        <div className="h-6 w-40 animate-pulse rounded-md bg-muted/60" />
        <div className="h-4 w-64 animate-pulse rounded-md bg-muted/40" />
      </div>
      <div className="flex gap-2">
        {[28, 36, 32, 40].map((w, i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-muted/40" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-6">
        {Array.from({ length: 18 }, (_, i) => (
          <div key={i} className="grid gap-2">
            <div className="aspect-square w-full animate-pulse rounded-xl bg-muted/50" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted/50" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-muted/30" />
          </div>
        ))}
      </div>
    </div>
  );
}
