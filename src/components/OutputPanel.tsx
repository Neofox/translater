import { ViewTransition } from 'react'
import { Loader2 } from 'lucide-react'
import CopyButton from './CopyButton'
import ListenButton from './ListenButton'
import LanguageChipBar from './LanguageChipBar'
import RefineRow from './RefineRow'
import SentenceView from './SentenceView'
import WordView from './WordView'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { mainText } from '../lib/liveResult'
import { isLongForm } from '../lib/longForm'

export default function OutputPanel() {
  const {
    input,
    source,
    target,
    setTarget,
    mode,
    isPolish,
    live,
    isPending,
    streaming,
    error,
    context,
    refinements,
  } = useTranslatorContext()
  const { t } = useUiLang()
  const copyText = mainText(live)
  const stale = isPending || input.trim() !== live?.text
  const speech = live?.done
    ? {
        language: live.partial.targetLang ?? target,
        disabled: stale,
        resetKey: JSON.stringify([
          input,
          source,
          target,
          mode,
          context,
          refinements,
        ]),
      }
    : undefined

  return (
    <section
      className="output-panel"
      aria-label={t('translation')}
      aria-busy={streaming}
    >
      <div className="target-toolbar" data-testid="target-toolbar">
        <LanguageChipBar
          kind="target"
          value={target}
          onChange={setTarget}
          aria-label={t('targetLanguage')}
        />
        {streaming && (
          <span className="stream-state">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            {isPolish ? t('polishing') : t('streaming')}
          </span>
        )}
      </div>
      <ViewTransition default="result-transition">
        <div
          className="result-scroll scrollbar-thin"
          data-testid="translation-result"
          tabIndex={0}
          aria-label={t('translation')}
        >
          {error && (
            <div className="result-error" role="alert">
              <p>{error.message}</p>
              {(error.hint || error.kind === 'server') && (
                <p className="mt-2 text-ink-dim">
                  {error.hint ?? t('errorEnvHint')}
                </p>
              )}
            </div>
          )}
          {!error && live && (
            <div className="result-content">
              <p
                className={`result-main ${live.intent === 'word' ? 'result-word' : ''}`}
                lang={live.partial.targetLang ?? target}
                data-testid="main-translation"
              >
                {copyText || <span className="text-ink-dim">&hellip;</span>}
                {streaming && copyText && (
                  <span className="result-cursor animate-pulse" aria-hidden />
                )}
              </p>
              <div className="result-actions" data-testid="output-toolbar">
                <div className="primary-result-actions">
                  {copyText && (
                    <CopyButton
                      text={copyText}
                      size="md"
                      primary
                      disabled={!live.done || stale}
                    />
                  )}
                  {speech && copyText?.trim() && (
                    <ListenButton {...speech} text={copyText} label />
                  )}
                </div>
                <RefineRow />
              </div>
              {live.intent === 'sentence' ? (
                <SentenceView
                  result={live.partial}
                  streaming={streaming}
                  speech={speech}
                  hideAlternatives={isLongForm(live.text)}
                />
              ) : (
                <WordView
                  result={live.partial}
                  mode={mode}
                  streaming={streaming}
                  speech={speech}
                />
              )}
            </div>
          )}
          {!error && !live && !isPending && (
            <div className="result-empty">
              <p>{t('emptyMain')}</p>
              <p>{t('emptySub')}</p>
            </div>
          )}
        </div>
      </ViewTransition>
    </section>
  )
}
