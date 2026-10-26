import type { SentenceResult } from '../server/schemas'
import AlternativeItem from './AlternativeItem'
import type { SpeechOptions } from '../hooks/useSpeech'
import AlternativeItemSkeleton from './AlternativeItemSkeleton'
import LearningTips from './LearningTips'
import ResultSection from './ResultSection'
import { useUiLang } from '../hooks/useUiLang'

type Props = {
  result: Partial<SentenceResult>
  registerLabel?: string
  copyDisabled?: boolean
  streaming?: boolean
  speech?: Omit<SpeechOptions, 'text'>
  hideAlternatives?: boolean
}

export default function SentenceView({
  result,
  streaming,
  hideAlternatives,
  speech,
  copyDisabled,
  registerLabel,
}: Props) {
  const { t } = useUiLang()
  const all = hideAlternatives ? [] : (result.alternatives ?? [])
  const settled = streaming ? all.slice(0, Math.max(0, all.length - 1)) : all
  const hasAlternatives = settled.length > 0 || Boolean(streaming && all.length)
  return (
    <div
      className={`result-details ${hasAlternatives ? 'has-alternatives' : ''}`}
    >
      {(result.rationale || result.formalityNote) && (
        <ResultSection
          title={t('whyWording')}
          tag={registerLabel}
          className="detail-why"
        >
          {result.rationale && <p>{result.rationale}</p>}
          {result.formalityNote && <p>{result.formalityNote}</p>}
        </ResultSection>
      )}
      {hasAlternatives && (
        <ResultSection
          title={t('alternatives')}
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
                copyDisabled={copyDisabled}
              />
            ))}
            {streaming && all.length > settled.length && (
              <AlternativeItemSkeleton />
            )}
          </ul>
        </ResultSection>
      )}
      <LearningTips tips={result.learningTips} />
    </div>
  )
}
