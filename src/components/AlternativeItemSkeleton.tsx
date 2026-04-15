export default function AlternativeItemSkeleton() {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-panel px-3 py-2">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-3/4 animate-pulse rounded bg-ink-dim/10" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-ink-dim/10" />
      </div>
    </li>
  )
}
