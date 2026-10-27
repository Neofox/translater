import SentenceView from './SentenceView'
import WordView from './WordView'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'

/** Learner content beside its source in a two-pane workspace. */
export default function ReferencePanel() {
  const { live, error, streaming, mode } = useTranslatorContext()
  const { t } = useUiLang()
  if (!live || error) return null
  return (
    <section className="reference-panel" aria-label={t('notes')}>
      <div
        className="reference-scroll scrollbar-thin"
        tabIndex={0}
        aria-label={t('notes')}
      >
        <h2 className="reference-heading">{t('notes')}</h2>
        {live.intent === 'sentence' ? (
          <SentenceView
            content="reference"
            result={live.partial}
            streaming={streaming}
          />
        ) : (
          <WordView
            content="reference"
            result={live.partial}
            mode={mode}
            streaming={streaming}
          />
        )}
      </div>
    </section>
  )
}
