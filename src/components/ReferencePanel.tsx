import LearningInspector from './LearningInspector'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { useLayoutEffect, useRef } from 'react'
import { useLearningContext } from '../context/LearningContext'

/** Learner content beside its source in a two-pane workspace. */
export default function ReferencePanel() {
  const { live, error } = useTranslatorContext()
  const { t } = useUiLang()
  const learning = useLearningContext()
  const heading = useRef<HTMLHeadingElement>(null)
  const wordOpen = live?.intent === 'word' && learning?.isOpen
  useLayoutEffect(() => {
    if (wordOpen) {
      heading.current?.focus({ preventScroll: true })
      heading.current?.parentElement?.scrollTo({ top: 0 })
    }
  }, [wordOpen])
  if (!live || error) return null
  if (live.intent === 'word' && learning && !learning.isOpen) return null
  return (
    <section className="reference-panel" aria-label={t('notes')}>
      <div
        className="reference-scroll scrollbar-thin"
        tabIndex={0}
        aria-label={t('notes')}
      >
        <h2 ref={heading} tabIndex={-1} className="reference-heading">
          {t('learn')}
        </h2>
        <LearningInspector />
      </div>
    </section>
  )
}
