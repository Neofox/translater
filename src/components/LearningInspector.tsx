import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useLearningContext } from '../context/LearningContext'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import type { StringKey } from '../lib/i18n'
import Pill from './ui/Pill'
import LearningTips from './LearningTips'
import WordSourceMeta from './WordSourceMeta'

const FACTS = [
  'gloss',
  'baseForm',
  'literalMeaning',
  'naturalMeaning',
  'grammar',
  'omissions',
] as const
const LABELS: Record<(typeof FACTS)[number], StringKey> = {
  gloss: 'inThisSentence',
  baseForm: 'baseForm',
  literalMeaning: 'literalMeaning',
  naturalMeaning: 'naturalMeaning',
  grammar: 'grammar',
  omissions: 'omissions',
}

export default function LearningInspector() {
  const learning = useLearningContext()
  const { live, streaming, lookupWord } = useTranslatorContext()
  const { t } = useUiLang()
  if (!live) return null
  const chunk = learning?.selectedChunk
  return (
    <div className="learning-inspector" data-testid="learning-inspector">
      {live.intent === 'sentence' && (
        <>
          {learning && learning.ranges.length > 1 && (
            <nav className="learning-sentences" aria-label={t('wholeSentence')}>
              <Pill
                size="md"
                aria-label={t('sentencePrevious')}
                disabled={learning.selectedSentence === 0}
                onClick={() =>
                  learning.selectSentence(learning.selectedSentence - 1)
                }
              >
                <ChevronLeft size={16} />
              </Pill>
              <span>
                {learning.selectedSentence + 1} / {learning.ranges.length}
              </span>
              <Pill
                size="md"
                aria-label={t('sentenceNext')}
                disabled={
                  learning.selectedSentence >= learning.ranges.length - 1
                }
                onClick={() =>
                  learning.selectSentence(learning.selectedSentence + 1)
                }
              >
                <ChevronRight size={16} />
              </Pill>
            </nav>
          )}
          {learning?.status === 'loading' && (
            <p className="learning-status" role="status">
              <Loader2 className="animate-spin" size={16} aria-hidden />
              {t('learningLoading')}
            </p>
          )}
          {learning?.status === 'error' && (
            <div className="learning-status" role="alert">
              <p>
                {t(
                  learning.error === 'learningTooLong'
                    ? 'learningTooLong'
                    : 'learningFailed',
                )}
              </p>
              {learning.error !== 'learningTooLong' && (
                <Pill tone="warm" size="md" onClick={learning.retry}>
                  {t('retry')}
                </Pill>
              )}
            </div>
          )}
          {learning?.status === 'ready' &&
            (chunk ? (
              <section aria-label={chunk.text}>
                <Pill
                  size="md"
                  className="learning-back"
                  onClick={() => learning.selectChunk(null)}
                >
                  <ArrowLeft size={16} aria-hidden />
                  {t('wholeSentence')}
                </Pill>
                <h3 className="learning-phrase" lang={live.partial.targetLang}>
                  {chunk.text}
                </h3>
                <dl className="learning-facts">
                  {FACTS.filter((key) => chunk[key].trim()).map((key) => (
                    <div key={key}>
                      <dt>{t(LABELS[key])}</dt>
                      <dd>{chunk[key]}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : (
              <section aria-label={t('wholeSentence')}>
                <ul className="learning-chunks">
                  {learning.result?.chunks.map((item, index) => (
                    <li key={`${item.start}:${item.end}`}>
                      <button
                        type="button"
                        aria-label={`${item.text} ${item.gloss || item.naturalMeaning}`}
                        onClick={() => learning.selectChunk(index)}
                        data-testid="learning-chunk"
                      >
                        <span lang={live.partial.targetLang}>{item.text}</span>
                        <span aria-hidden="true">→</span>
                        <span>{item.gloss || item.naturalMeaning}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {learning.result?.wordOrder && (
                  <p className="learning-order">{learning.result.wordOrder}</p>
                )}
                {learning.result?.partial && (
                  <p className="learning-status">{t('learningPartial')}</p>
                )}
              </section>
            ))}
        </>
      )}
      {!chunk && (
        <>
          {live.intent === 'word' && (
            <section aria-label={t('wordDetails')}>
              <h3 className="learning-subheading">
                {t('aboutWord')}
                {live.partial.headword ? ` · ${live.partial.headword}` : ''}
              </h3>
              <WordSourceMeta
                result={live.partial}
                streaming={streaming}
                onLookup={lookupWord}
              />
            </section>
          )}
          <LearningTips tips={live.partial.learningTips} />
        </>
      )}
    </div>
  )
}
