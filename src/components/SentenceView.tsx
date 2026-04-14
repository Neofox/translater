import type { SentenceResult } from '../server/schemas'
import CopyButton from './CopyButton'

type Props = {
  result: Partial<SentenceResult>
  streaming?: boolean
}

export default function SentenceView({ result, streaming }: Props) {
  const alternatives = result.alternatives ?? []
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
        <div className="rounded-lg border border-border bg-panel px-4 py-3 text-sm text-ink-soft">
          <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
            Context
          </span>
          {result.formalityNote}
        </div>
      )}

      {alternatives.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Alternatives
          </p>
          <ul className="space-y-2">
            {alternatives.map((alt, i) => (
              <li
                key={i}
                className="group flex items-start justify-between gap-3 rounded-lg border border-border bg-panel px-4 py-3"
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
          </ul>
        </div>
      )}
    </div>
  )
}
