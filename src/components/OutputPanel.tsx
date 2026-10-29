import { ViewTransition } from 'react'
import { ArrowRightLeft, RotateCcw, TriangleAlert, Loader2 } from 'lucide-react'
import CopyButton from './CopyButton'
import ListenButton from './ListenButton'
import LanguageChipBar from './LanguageChipBar'
import Pill from './ui/Pill'
import MainExplanation from './MainExplanation'
import SentenceView from './SentenceView'
import WordView from './WordView'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { copyableMainText, mainText, resultIsCurrent } from '../lib/liveResult'
import { isLongForm } from '../lib/longForm'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useLearningContext } from '../context/LearningContext'
import InspectableTranslation from './InspectableTranslation'
import LearningPanel from './LearningPanel'
import { useStreamingText } from '../hooks/useStreamingText'

export default function OutputPanel() {
  const learning = useLearningContext()
  const {
    input,
    source,
    target,
    setTarget,
    setSource,
    setInput,
    detected,
    run,
    mode,
    isPolish,
    live,
    isPending,
    streaming,
    error,
    context,
    refinements,
  } = useTranslatorContext()
  const { t, lang } = useUiLang()
  const { mode: layoutMode, desktop } = useWorkspaceLayoutContext()
  const mobileLearning = Boolean(!desktop && learning?.isOpen)
  const separateReference = ['workspace', 'split', 'book'].includes(layoutMode)
  const copyText = mainText(live)
  const reveal = useStreamingText(
    copyText ?? '',
    Boolean(streaming && !live?.mainReady && !live?.done && !error),
    JSON.stringify([
      live?.requestKey,
      live?.text,
      source,
      target,
      mode,
      context,
      refinements,
      lang,
    ]),
  )
  const copyReady = copyableMainText(
    live,
    {
      text: input,
      source,
      target,
      mode,
      context,
      refinements,
      uiLang: lang,
    },
    isPending,
  )
  const stale =
    isPending ||
    !resultIsCurrent(live, {
      text: input,
      source,
      target,
      mode,
      context,
      refinements,
      uiLang: lang,
    })
  const speech = {
    language: live?.partial.targetLang ?? target,
    disabled: Boolean(error) || stale || !live?.done,
    resetKey: JSON.stringify([
      input,
      source,
      target,
      mode,
      context,
      refinements,
    ]),
  }

  return (
    <section
      className="output-panel"
      aria-label={t('translation')}
      aria-busy={streaming}
      onKeyDown={(event) => {
        if (mobileLearning && event.key === 'Escape') {
          event.stopPropagation()
          learning?.close()
        }
      }}
    >
      <div
        className="target-toolbar"
        data-testid="target-toolbar"
        inert={mobileLearning}
      >
        <button
          type="button"
          className="swap-button"
          aria-label={t('swapLanguages')}
          onClick={() => {
            const from = source === 'auto' ? (detected ?? 'en') : source
            if (live?.done && !stale && copyText) {
              setInput(copyText)
              setSource('auto')
              setTarget(from)
            } else {
              setSource(target)
              setTarget(from)
            }
          }}
        >
          {streaming ? (
            <Loader2 size={18} className="animate-spin" aria-hidden />
          ) : (
            <ArrowRightLeft size={18} aria-hidden />
          )}
        </button>
        <LanguageChipBar
          kind="target"
          value={target}
          onChange={setTarget}
          aria-label={t('targetLanguage')}
        />
        {streaming && (
          <span className="sr-only" role="status">
            {isPolish ? t('polishing') : t('streaming')}
          </span>
        )}
      </div>
      <div className="result-actions" data-testid="output-toolbar">
        <div className="primary-result-actions">
          <CopyButton
            text={copyText ?? ''}
            size="md"
            primary
            disabled={!copyReady || Boolean(error)}
          />
          <ListenButton {...speech} text={copyText ?? ''} label />
        </div>
      </div>
      <ViewTransition default="result-transition">
        <div
          className="result-scroll scrollbar-thin"
          data-testid="translation-result"
          onFocusCapture={reveal.revealAll}
          tabIndex={0}
          aria-label={t('translation')}
          inert={mobileLearning}
        >
          {error && (
            <div className="result-error" role="alert">
              <TriangleAlert size={28} aria-hidden className="state-icon" />
              <p className="state-title">{t('translationFailedTitle')}</p>
              <p className="state-body">{error.message}</p>
              {(error.hint || error.kind === 'server') && (
                <p className="mt-2 text-ink-dim">
                  {error.hint ?? t('errorEnvHint')}
                </p>
              )}
              {error.kind === 'server' && (
                <div className="state-actions">
                  <Pill
                    tone="accent"
                    className="retry-button"
                    size="md"
                    onClick={() => void run(undefined, 'force')}
                  >
                    <RotateCcw size={18} aria-hidden />
                    {t('retry')}
                  </Pill>
                </div>
              )}
            </div>
          )}
          {!error && live && (
            <div className="result-content">
              <InspectableTranslation
                className={`result-main ${live.intent === 'word' ? 'result-word' : ''}`}
                language={live.partial.targetLang ?? target}
                text={reveal.text}
                onReveal={reveal.revealAll}
                wholeTextInteractive={!desktop && Boolean(learning?.isSentence)}
                disabled={
                  !learning?.canOpen ||
                  (desktop && learning.isSentence && learning.side === 'source')
                }
                actionLabel={
                  learning && !learning.isSentence
                    ? `${t('wordDetails')}: ${copyText ?? ''}`
                    : undefined
                }
                expanded={
                  live.intent === 'word' && separateReference
                    ? true
                    : learning?.isOpen
                }
                selectedChunk={
                  learning?.side === 'source' && learning.isSentence
                    ? null
                    : learning?.selectedChunk
                }
                chunks={
                  learning?.side === 'source'
                    ? []
                    : learning?.preparedHighlights
                }
                onInspect={
                  learning?.isSentence
                    ? (offset) => {
                        if (
                          !desktop &&
                          document.activeElement instanceof HTMLElement
                        )
                          document.activeElement.blur()
                        if (learning.side === 'source') {
                          const chunk = learning.preparedChunks.find((c) =>
                            c.sourceSpans.some(
                              (span) =>
                                offset >= span.start && offset < span.end,
                            ),
                          )
                          learning.openAt(chunk?.start)
                        } else learning.openAt(offset)
                      }
                    : () => {
                        if (learning?.isOpen && !separateReference)
                          learning.close()
                        else learning?.openAt()
                      }
                }
                resetKey={learning?.identity}
              >
                {!reveal.text &&
                  (streaming && !live.mainReady ? (
                    <span className="result-cursor animate-pulse" aria-hidden />
                  ) : (
                    <span className="text-ink-dim">&hellip;</span>
                  ))}
                {streaming && !live.mainReady && copyText && (
                  <span className="result-cursor animate-pulse" aria-hidden />
                )}
              </InspectableTranslation>
              <MainExplanation
                live={live}
                streaming={streaming}
                registerLabel={
                  live.intent === 'sentence' && live.partial.targetLang === 'ko'
                    ? mode === 'friends'
                      ? '반말'
                      : mode === 'casual'
                        ? '해요체'
                        : '존댓말'
                    : undefined
                }
              />
              {learning && (
                <div
                  data-testid="tight-learning-slot"
                  className="tight-learning-slot"
                />
              )}
              {live.intent === 'sentence' ? (
                <SentenceView
                  content={
                    learning || separateReference ? 'alternatives' : 'all'
                  }
                  result={live.partial}
                  streaming={streaming}
                  speech={speech}
                  copyDisabled={!live.done || stale}
                  hideAlternatives={isLongForm(live.text)}
                />
              ) : (
                <WordView
                  content={
                    learning || separateReference ? 'alternatives' : 'all'
                  }
                  result={live.partial}
                  mode={mode}
                  streaming={streaming}
                  speech={speech}
                  copyDisabled={!live.done || stale}
                />
              )}
            </div>
          )}
          {!error && !live && !isPending && (
            <div className="result-empty">
              <p>{t('emptyMain')}</p>
            </div>
          )}
        </div>
      </ViewTransition>
      <LearningPanel />
    </section>
  )
}
