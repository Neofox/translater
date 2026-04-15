import type { SentenceResult } from '../server/schemas'
import AlternativeItem from './AlternativeItem'
import AlternativeItemSkeleton from './AlternativeItemSkeleton'

type Props = {
  result: Partial<SentenceResult>
  streaming?: boolean
}

export default function SentenceView({ result, streaming }: Props) {
  const all = result.alternatives ?? []
  const settled = streaming ? all.slice(0, Math.max(0, all.length - 1)) : all

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-6 scrollbar-thin">
      <div>
        <p className="whitespace-pre-wrap text-2xl leading-snug text-ink">
          {result.main || <span className="text-ink-dim">&hellip;</span>}
          {streaming && result.main && (
            <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-1 animate-pulse bg-accent align-baseline" />
          )}
        </p>
        {result.rationale && (
          <p className="mt-2 text-sm italic text-ink-soft">
            {result.rationale}
          </p>
        )}
      </div>

      {result.formalityNote && (
        <div className="animate-settle rounded-lg border border-border bg-panel px-4 py-3 text-sm text-ink-soft">
          <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-warm">
            Context
          </span>
          {result.formalityNote}
        </div>
      )}

      {(settled.length > 0 || (streaming && all.length > 0)) && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Alternatives
          </p>
          <ul className="space-y-1.5">
            {settled.map((alt, i) => (
              <AlternativeItem
                key={i}
                index={i}
                text={alt.text}
                note={alt.note}
              />
            ))}
            {streaming && all.length > settled.length && (
              <AlternativeItemSkeleton />
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
