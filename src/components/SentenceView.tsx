import type { SentenceResult } from '../server/schemas'
import CopyButton from './CopyButton'

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
        {result.main && (
          <div className="mt-3">
            <CopyButton text={result.main} />
          </div>
        )}
      </div>

      {result.formalityNote && (
        <div className="animate-settle rounded-lg border border-border bg-panel px-4 py-3 text-sm text-ink-soft">
          <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
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
          <ul className="space-y-2">
            {settled.map((alt, i) => (
              <li
                key={i}
                className="animate-settle group flex items-start justify-between gap-3 rounded-lg border border-border bg-panel px-4 py-3"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-base text-ink">
                    {alt.text}
                  </p>
                  {alt.note && (
                    <p className="mt-0.5 text-xs text-ink-dim">{alt.note}</p>
                  )}
                </div>
                {alt.text && (
                  <div className="shrink-0 opacity-60 transition group-hover:opacity-100">
                    <CopyButton text={alt.text} />
                  </div>
                )}
              </li>
            ))}
            {streaming && all.length > settled.length && (
              <li className="flex items-start gap-3 rounded-lg border border-border bg-panel px-4 py-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-ink-dim/10" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-ink-dim/10" />
                </div>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
