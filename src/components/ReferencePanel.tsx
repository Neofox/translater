import LearningInspector from './LearningInspector'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'

/** Learner content beside its source in a two-pane workspace. */
export default function ReferencePanel() {
  const { live, error } = useTranslatorContext()
  const { t } = useUiLang()
  if (!live || error) return null
  return (
    <section className="reference-panel" aria-label={t('notes')}>
      <div
        className="reference-scroll scrollbar-thin"
        tabIndex={0}
        aria-label={t('notes')}
      >
        <h2 className="reference-heading">{t('learn')}</h2>
        <LearningInspector />
      </div>
    </section>
  )
}
