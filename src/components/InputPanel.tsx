import { useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, Clipboard, X } from 'lucide-react'
import Pill from './ui/Pill'
import LanguageChipBar from './LanguageChipBar'
import { ContextTextarea, ContextToggle } from './ContextField'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useUiLang } from '../hooks/useUiLang'
import { INPUT_WARN_THRESHOLD, MAX_INPUT_CHARS } from '../lib/limits'
import { STRINGS } from '../lib/i18n'
import { copyableMainText } from '../lib/liveResult'
import { useLearningContext } from '../context/LearningContext'
import SourceHighlight from './SourceHighlight'

export default function InputPanel({ children }: { children?: ReactNode }) {
  const learning = useLearningContext()
  const {
    input,
    setInput,
    source,
    target,
    mode,
    refinements,
    live,
    isPending,
    setSource,
    detected,
    clearInput,
    textareaRef,
    flush,
    queueImmediate,
    context,
  } = useTranslatorContext()
  const { t, lang } = useUiLang()
  const layout = useWorkspaceLayoutContext()
  const [contextOpen, setContextOpen] = useState(false)
  const [contextEditing, setContextEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [hadResult, setHadResult] = useState(false)
  const overLimit = input.length > MAX_INPUT_CHARS
  const showLimit = input.length >= INPUT_WARN_THRESHOLD
  const eligible =
    layout.mode === 'stack' && layout.resultFirst && !layout.desktop
  const ready = Boolean(
    copyableMainText(
      live,
      { text: input, source, target, mode, context, refinements, uiLang: lang },
      isPending,
    ),
  )
  const canCondense = eligible && Boolean(input.trim()) && (ready || hadResult)
  const compact = canCondense && !expanded && !contextEditing && !showLimit
  useEffect(() => {
    if (!input.trim()) {
      setHadResult(false)
      setExpanded(false)
    } else if (ready) setHadResult(true)
  }, [input, ready])
  useEffect(() => {
    if (context.trim()) setContextOpen(true)
  }, [context])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const resize = () => {
      textarea.style.height = '0px'
      const style = getComputedStyle(textarea)
      const minimum = parseFloat(style.minHeight) || 52
      const maximum = parseFloat(style.maxHeight) || 180
      const border =
        (parseFloat(style.borderTopWidth) || 0) +
        (parseFloat(style.borderBottomWidth) || 0)
      textarea.style.height = `${Math.max(minimum, Math.min(maximum, textarea.scrollHeight + border))}px`
    }
    resize()
    let width = textarea.parentElement?.clientWidth
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(([entry]) => {
            if (entry && entry.contentRect.width !== width) {
              width = entry.contentRect.width
              resize()
            }
          })
    if (textarea.parentElement) observer?.observe(textarea.parentElement)
    return () => observer?.disconnect()
  }, [input, contextOpen, layout, compact, textareaRef])

  const count = (showLimit ? STRINGS[lang].charCount : STRINGS[lang].inputCount)
    .replace('{count}', String(input.length))
    .replace('{max}', String(MAX_INPUT_CHARS))
  const focusSource = () => {
    const textarea = textareaRef.current
    const active = document.activeElement
    // Context focus can temporarily hide the inactive source on tight panes.
    // Release it before focusing source, within the original user gesture.
    if (active instanceof HTMLElement && active !== textarea) active.blur()
    textarea?.focus({ preventScroll: true })
  }
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        queueImmediate('paste')
        setInput(text)
        focusSource()
      }
    } catch {
      /* Keep the current draft when clipboard access is unavailable. */
    }
  }

  return (
    <section
      className="input-panel"
      aria-label={t('sourceText')}
      data-source-compact={compact || undefined}
    >
      <div className="composer">
        <div className="composer-header">
          <LanguageChipBar
            kind="source"
            value={source}
            onChange={setSource}
            detected={detected}
            aria-label={t('sourceLanguage')}
          />
        </div>
        <div className="composer-field">
          {contextOpen && (
            <div
              className="composer-context"
              onFocusCapture={() => setContextEditing(true)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setContextEditing(false)
              }}
            >
              <ContextTextarea />
            </div>
          )}
          <div className="source-input-area">
            {learning?.selectedChunk && (
              <SourceHighlight
                text={input}
                spans={learning.selectedChunk.sourceSpans}
                textareaRef={textareaRef}
              />
            )}
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onFocus={() => {
                if (layout.keyboard) {
                  setContextOpen(false)
                  setContextEditing(false)
                }
              }}
              onPaste={() => queueImmediate('paste')}
              onBlur={(event) => {
                const next = event.relatedTarget
                if (!(
                  next instanceof Element && next.closest('[data-input-action]')
                ))
                  flush('blur')
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.nativeEvent.isComposing &&
                  flush('enter')
                )
                  event.preventDefault()
              }}
              placeholder={t('placeholder')}
              aria-label={t('inputText')}
              data-testid="input-textarea"
              className="translation-input scrollbar-thin"
              spellCheck
              autoComplete="off"
              autoCorrect="on"
            />
          </div>
          <div className="composer-actions">
            <Pill
              size="md"
              tone="primary"
              className="paste-button"
              onClick={() => void paste()}
              aria-label={t('pasteClipboard')}
              data-testid="paste-input"
              data-input-action
              onPointerDown={(event) => event.preventDefault()}
            >
              <Clipboard size={16} aria-hidden />
              <span>{t('paste')}</span>
            </Pill>
            <Pill
              size="md"
              className="clear-button"
              onClick={() => {
                learning?.close()
                clearInput()
                focusSource()
              }}
              title={t('clearInputTitle')}
              aria-label={t('clearInput')}
              data-testid="clear-input"
              data-input-action
              onPointerDown={(event) => event.preventDefault()}
            >
              <X size={16} aria-hidden />
              <span>{t('clear')}</span>
            </Pill>
            {canCondense && (
              <Pill
                size="md"
                tone={context.trim() ? 'active' : 'neutral'}
                className="source-expand-button"
                data-testid="source-expand"
                data-context={Boolean(context.trim()) || undefined}
                data-input-action
                aria-label={compact ? t('expandSource') : t('collapseSource')}
                title={compact ? t('expandSource') : t('collapseSource')}
                aria-expanded={!compact}
                aria-description={
                  context.trim() ? t('contextActive') : undefined
                }
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (compact) setExpanded(true)
                  else {
                    setExpanded(false)
                    setContextOpen(false)
                    setContextEditing(false)
                  }
                  focusSource()
                }}
              >
                {compact ? (
                  <ChevronUp size={18} aria-hidden />
                ) : (
                  <ChevronDown size={18} aria-hidden />
                )}
              </Pill>
            )}
          </div>
          <div className="composer-meta">
            <ContextToggle
              open={contextOpen}
              onToggle={() => {
                if (contextOpen) setContextEditing(false)
                setContextOpen((value) => !value)
              }}
            />
            <span
              className={`input-count ${showLimit ? 'input-count-visible' : ''} ${overLimit ? 'text-red-400' : 'text-ink-dim'}`}
              aria-live={showLimit ? 'polite' : undefined}
            >
              {count}
            </span>
          </div>
        </div>
      </div>
      {children}
    </section>
  )
}
