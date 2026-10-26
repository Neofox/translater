/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Streamed JSON can omit nested fields until final schema validation. */
import type { WordResult } from '../server/schemas'
import type { Mode } from '../lib/types'
import AlternativeItem from './AlternativeItem'
import type { SpeechOptions } from '../hooks/useSpeech'
import AlternativeItemSkeleton from './AlternativeItemSkeleton'
import Tag from './ui/Tag'
import { useUiLang } from '../hooks/useUiLang'
import type { StringKey } from '../lib/i18n'

const MODE_KEY: Record<Mode, StringKey> = {
  friends: 'modeFriends',
  casual: 'modeCasual',
  professional: 'modeProfessional',
}

type Props = {
  result: Partial<WordResult>
  mode: Mode
  streaming?: boolean
  speech?: Omit<SpeechOptions, 'text'>
}

export default function WordView({ result, mode, streaming, speech }: Props) {
  const { t } = useUiLang()
  const all = result.alternativeTranslations ?? []
  const settled = streaming ? all.slice(0, Math.max(0, all.length - 1)) : all

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-6 scrollbar-thin xl:px-12 2xl:px-18">
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
            {t('alternativeTranslations')}
            <Tag tone="accent">{t(MODE_KEY[mode])}</Tag>
          </p>
          <ul className="space-y-1.5">
            {settled.map((alt, i) => (
              <AlternativeItem
                key={i}
                index={i}
                text={alt.text}
                note={alt.note}
                speech={speech}
              >
                {(alt.register ?? []).map((r) => (
                  <Tag key={r} tone="neutral">
                    {r}
                  </Tag>
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
