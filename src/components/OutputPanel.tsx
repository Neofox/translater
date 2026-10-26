import { ViewTransition } from 'react'
import { ArrowRightLeft, RotateCcw, TriangleAlert, Loader2 } from 'lucide-react'
import CopyButton from './CopyButton'
import ListenButton from './ListenButton'
import LanguageChipBar from './LanguageChipBar'
import RefineRow from './RefineRow'
import Pill from './ui/Pill'
import Tag from './ui/Tag'
import { useKbd } from '../hooks/useKbd'
import SentenceView from './SentenceView'
import WordView from './WordView'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { copyableMainText, mainText, resultIsCurrent } from '../lib/liveResult'
import { isLongForm } from '../lib/longForm'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'

export default function OutputPanel() {
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
  const { mod, shift } = useKbd()
  const { desktop } = useWorkspaceLayoutContext()
  const copyText = mainText(live)
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
          <ArrowRightLeft size={18} aria-hidden />
        </button>
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
              <p
                className={`result-main ${live.intent === 'word' ? 'result-word' : ''}`}
                lang={live.partial.targetLang ?? target}
                data-testid="main-translation"
              >
                {copyText ||
                  (streaming ? (
                    <span className="result-cursor animate-pulse" aria-hidden />
                  ) : (
                    <span className="text-ink-dim">&hellip;</span>
                  ))}
                {streaming && copyText && (
                  <span className="result-cursor animate-pulse" aria-hidden />
                )}
              </p>
              <div className="result-actions" data-testid="output-toolbar">
                <div className="primary-result-actions">
                  <CopyButton
                    text={copyText ?? ''}
                    size="md"
                    primary
                    compact={!desktop}
                    disabled={!copyReady}
                  />
                  {speech && copyText?.trim() && (
                    <ListenButton {...speech} text={copyText} label={desktop} />
                  )}
                  {live.intent === 'word' && live.partial.posList?.[0]?.pos && (
                    <Tag tone="warm">{live.partial.posList[0].pos}</Tag>
                  )}
                  <kbd className="result-shortcut">
                    {mod}
                    {shift}C
                  </kbd>
                </div>
                <RefineRow />
              </div>
              {streaming && (
                <div className="stream-skeleton" aria-hidden>
                  <span />
                  <span />
                  <span />
                </div>
              )}
              {live.intent === 'sentence' ? (
                <SentenceView
                  result={live.partial}
                  streaming={streaming}
                  speech={speech}
                  copyDisabled={!live.done || stale}
                  registerLabel={
                    live.partial.targetLang === 'ko'
                      ? mode === 'friends'
                        ? '반말'
                        : mode === 'casual'
                          ? '해요체'
                          : '존댓말'
                      : undefined
                  }
                  hideAlternatives={isLongForm(live.text)}
                />
              ) : (
                <WordView
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
    </section>
  )
}
