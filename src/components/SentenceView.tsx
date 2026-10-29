import type { SentenceResult } from '../server/schemas'
import AlternativeItem from './AlternativeItem'
import type { SpeechOptions } from '../hooks/useSpeech'
import AlternativeItemSkeleton from './AlternativeItemSkeleton'
import ResultSection from './ResultSection'
import { useUiLang } from '../hooks/useUiLang'

type Props = {
  content?: 'all' | 'alternatives' | 'reference'
  result: Partial<SentenceResult>
  copyDisabled?: boolean
  streaming?: boolean
  speech?: Omit<SpeechOptions, 'text'>
  hideAlternatives?: boolean
}

export default function SentenceView({
  content = 'all',
  result,
  streaming,
  hideAlternatives,
  speech,
  copyDisabled,
}: Props) {
  const { t } = useUiLang()
  const all =
    hideAlternatives || content === 'reference'
      ? []
      : (result.alternatives ?? [])
  const settled = streaming ? all.slice(0, Math.max(0, all.length - 1)) : all
  const hasAlternatives = settled.length > 0 || Boolean(streaming && all.length)
  return (
    <div
      className={`result-details ${hasAlternatives ? 'has-alternatives' : ''}`}
    >
      {hasAlternatives && (
        <ResultSection
          title={t('alternatives')}
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
              />
            ))}
            {streaming && all.length > settled.length && (
              <AlternativeItemSkeleton speech={speech} />
            )}
          </ul>
        </ResultSection>
      )}
    </div>
  )
}
