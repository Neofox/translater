import type { WordResult } from '../server/schemas'
import CopyButton from './CopyButton'

type Mode = 'friends' | 'casual' | 'professional'

const MODE_LABEL: Record<Mode, string> = {
  friends: 'Friends',
  casual: 'Casual',
  professional: 'Professional',
}

type Props = {
  result: Partial<WordResult>
  mode: Mode
  streaming?: boolean
}

export default function WordView({ result, mode, streaming }: Props) {
  const all = result.alternativeTranslations ?? []
  const settled = streaming ? all.slice(0, Math.max(0, all.length - 1)) : all

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-6 scrollbar-thin">
      <div>
        <p className="text-3xl font-semibold text-ink">
          {result.primaryTranslation || (
            <span className="text-ink-dim">&hellip;</span>
          )}
          {streaming && result.primaryTranslation && (
            <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-1 animate-pulse bg-accent align-baseline" />
          )}
        </p>
        {result.primaryUsageNote && (
          <p className="mt-2 text-sm italic text-ink-soft">
            {result.primaryUsageNote}
          </p>
        )}
        {result.primaryTranslation && (
          <div className="mt-3">
            <CopyButton text={result.primaryTranslation} />
          </div>
        )}
      </div>

      {(settled.length > 0 || (streaming && all.length > 0)) && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Alternative translations
            <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-ink-soft">
              {MODE_LABEL[mode]}
            </span>
          </p>
          <ul className="space-y-2">
            {settled.map((alt, i) => (
              <li
                key={i}
                className="animate-settle group flex items-start justify-between gap-3 rounded-lg border border-border bg-panel px-4 py-3"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-base text-ink">{alt.text}</p>
                    {alt.register?.map((r) => (
                      <span
                        key={r}
                        className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-dim"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
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
