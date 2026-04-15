import type { WordResult } from '../server/schemas'
import { MODE_LABEL } from '../lib/types'
import type { Mode } from '../lib/types'
import AlternativeItem from './AlternativeItem'
import AlternativeItemSkeleton from './AlternativeItemSkeleton'

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
      </div>

      {(settled.length > 0 || (streaming && all.length > 0)) && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Alternative translations
            <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-ink-soft">
              {MODE_LABEL[mode]}
            </span>
          </p>
          <ul className="space-y-1.5">
            {settled.map((alt, i) => (
              <AlternativeItem
                key={i}
                index={i}
                text={alt.text}
                note={alt.note}
              >
                {alt.register.map((r) => (
                  <span
                    key={r}
                    className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-dim"
                  >
                    {r}
                  </span>
                ))}
              </AlternativeItem>
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
