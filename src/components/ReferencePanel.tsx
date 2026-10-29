import LearningInspector from './LearningInspector'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { useLayoutEffect, useRef } from 'react'
import { useLearningContext } from '../context/LearningContext'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'

/** Learner content beside its source in a two-pane workspace. */
export default function ReferencePanel() {
  const { live, error } = useTranslatorContext()
  const { t } = useUiLang()
  const learning = useLearningContext()
  const { desktop } = useWorkspaceLayoutContext()
  const heading = useRef<HTMLHeadingElement>(null)
  const wordOpen = live?.intent === 'word' && learning?.isOpen
  useLayoutEffect(() => {
    if (wordOpen) {
      heading.current?.focus({ preventScroll: true })
      heading.current?.parentElement?.scrollTo({ top: 0 })
    }
  }, [wordOpen, learning?.wordActivation])
  if (
    (!desktop && learning?.isOpen) ||
    !live ||
    error ||
    (live.intent === 'sentence' && !learning?.result)
  )
    return null
  return (
    <section
      className="reference-panel"
      aria-label={t('notes')}
      data-word-active={wordOpen || undefined}
    >
      <div
        className="reference-scroll scrollbar-thin"
        tabIndex={0}
        aria-label={t('notes')}
      >
        <h2 ref={heading} tabIndex={-1} className="reference-heading">
          {wordOpen
            ? `${t('wordDetails')} · ${live.partial.headword ?? ''}`
            : desktop
              ? t(live.intent === 'word' ? 'wordDetails' : 'breakdown')
              : t('learn')}
        </h2>
        <LearningInspector />
      </div>
    </section>
  )
}
