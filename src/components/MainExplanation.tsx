import type { LiveResult } from '../hooks/useTranslate'
import { useUiLang } from '../hooks/useUiLang'

/** Keep each result's explanation with the wording it describes. */
export default function MainExplanation({
  live,
  registerLabel,
  streaming,
}: {
  live: LiveResult
  registerLabel?: string
  streaming: boolean
}) {
  const { t } = useUiLang()
  const title = live.intent === 'sentence' ? t('whyWording') : t('usage')
  const rationale =
    live.intent === 'sentence'
      ? live.partial.rationale
      : live.partial.primaryUsageNote
  const formality =
    live.intent === 'sentence' ? live.partial.formalityNote : undefined
  if (!rationale && !formality && !streaming) return null
  return (
    <section className="main-explanation detail-why" aria-label={title}>
      <h3 className="sr-only">{title}</h3>
      {!rationale && !formality ? (
        <span className="main-explanation-skeleton animate-pulse" aria-hidden />
      ) : (
        <p>
          {registerLabel && (
            <span className="section-tag" lang="ko">
              {registerLabel}
            </span>
          )}
          {rationale && <span>{rationale}</span>}
          {rationale && formality && ' '}
          {formality && <span>{formality}</span>}
        </p>
      )}
    </section>
  )
}
