/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Streamed JSON can omit nested fields. */
import type { WordResult } from '../server/schemas'
import type { Mode } from '../lib/types'
import AlternativeItem from './AlternativeItem'
import type { SpeechOptions } from '../hooks/useSpeech'
import AlternativeItemSkeleton from './AlternativeItemSkeleton'
import Tag from './ui/Tag'
import ResultSection from './ResultSection'
import WordSourceMeta from './WordSourceMeta'
import { useUiLang } from '../hooks/useUiLang'
import { useTranslatorContext } from '../context/TranslatorContext'

type Props = {
  content?: 'all' | 'alternatives' | 'reference'
  result: Partial<WordResult>
  mode: Mode
  copyDisabled?: boolean
  streaming?: boolean
  speech?: Omit<SpeechOptions, 'text'>
}

export default function WordView({
  content = 'all',
  result,
  streaming,
  speech,
  copyDisabled,
}: Props) {
  const { t } = useUiLang()
  const { lookupWord } = useTranslatorContext()
  const all =
    content === 'reference' ? [] : (result.alternativeTranslations ?? [])
  const settled = streaming ? all.slice(0, Math.max(0, all.length - 1)) : all
  const hasAlternatives = settled.length > 0 || Boolean(streaming && all.length)
  const about = content !== 'alternatives' && (
    <ResultSection
      title={`${t('aboutWord')}${result.headword ? ` · ${result.headword}` : ''}`}
      className="detail-about"
    >
      <WordSourceMeta
        result={result}
        streaming={streaming}
        onLookup={lookupWord}
      />
    </ResultSection>
  )
  return (
    <div
      className={`result-details ${hasAlternatives ? 'has-alternatives' : ''}`}
    >
      {hasAlternatives && (
        <ResultSection
          title={t('alternativeTranslations')}
          className="detail-alternatives"
          alwaysOpen
        >
          <ul className="alternative-list">
            {settled.map((alt, index) => (
              <AlternativeItem
                key={index}
                index={index}
                text={alt.text}
                note={alt.note}
                speech={speech}
                copyDisabled={copyDisabled}
              >
                {(alt.register ?? []).map((register) => (
                  <Tag key={register}>{register}</Tag>
                ))}
              </AlternativeItem>
            ))}
            {streaming && all.length > settled.length && (
              <AlternativeItemSkeleton speech={speech} />
            )}
          </ul>
        </ResultSection>
      )}
      {content === 'reference' && about}
      {content !== 'reference' && about}
    </div>
  )
}
