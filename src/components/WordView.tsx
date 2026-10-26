/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Streamed JSON can omit nested fields. */
import type { WordResult } from '../server/schemas'
import type { Mode } from '../lib/types'
import AlternativeItem from './AlternativeItem'
import type { SpeechOptions } from '../hooks/useSpeech'
import AlternativeItemSkeleton from './AlternativeItemSkeleton'
import Tag from './ui/Tag'
import LearningTips from './LearningTips'
import ResultSection from './ResultSection'
import WordSourceMeta from './WordSourceMeta'
import { useUiLang } from '../hooks/useUiLang'
import { useTranslatorContext } from '../context/TranslatorContext'

type Props = {
  result: Partial<WordResult>
  mode: Mode
  streaming?: boolean
  speech?: Omit<SpeechOptions, 'text'>
}

export default function WordView({ result, streaming, speech }: Props) {
  const { t } = useUiLang()
  const { lookupWord } = useTranslatorContext()
  const all = result.alternativeTranslations ?? []
  const settled = streaming ? all.slice(0, Math.max(0, all.length - 1)) : all
  const hasAlternatives = settled.length > 0 || Boolean(streaming && all.length)
  return (
    <div
      className={`result-details ${hasAlternatives ? 'has-alternatives' : ''}`}
    >
      {hasAlternatives && (
        <ResultSection
          title={t('alternativeTranslations')}
          className="detail-alternatives"
        >
          <ul className="alternative-list">
            {settled.map((alt, index) => (
              <AlternativeItem
                key={index}
                index={index}
                text={alt.text}
                note={alt.note}
                speech={speech}
              >
                {(alt.register ?? []).map((register) => (
                  <Tag key={register}>{register}</Tag>
                ))}
              </AlternativeItem>
            ))}
            {streaming && all.length > settled.length && (
              <AlternativeItemSkeleton />
            )}
          </ul>
        </ResultSection>
      )}
      {result.primaryUsageNote && (
        <ResultSection title={t('usage')} className="detail-why">
          <p>{result.primaryUsageNote}</p>
        </ResultSection>
      )}
      <LearningTips tips={result.learningTips} />
      <div className="detail-word-meta">
        <WordSourceMeta
          result={result}
          streaming={streaming}
          onLookup={lookupWord}
        />
      </div>
    </div>
  )
}
