import { useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Clipboard, X } from 'lucide-react'
import Pill from './ui/Pill'
import LanguageChipBar from './LanguageChipBar'
import { ContextTextarea, ContextToggle } from './ContextField'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useUiLang } from '../hooks/useUiLang'
import { INPUT_WARN_THRESHOLD, MAX_INPUT_CHARS } from '../lib/limits'
import { STRINGS } from '../lib/i18n'
import { useLearningContext } from '../context/LearningContext'
import SourceHighlight from './SourceHighlight'

export default function InputPanel({ children }: { children?: ReactNode }) {
  const learning = useLearningContext()
  const {
    input,
    setInput,
    source,
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
  const sourceGrammar =
    learning?.side === 'source' ? learning.preparedHighlights : []
  const sourceSpans = learning?.selectedChunk
    ? learning.side === 'source'
      ? [learning.selectedChunk]
      : learning.selectedChunk.sourceSpans
    : []
  const overLimit = input.length > MAX_INPUT_CHARS
  const showLimit = input.length >= INPUT_WARN_THRESHOLD
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
    let frame = 0
    let width = textarea.parentElement?.clientWidth
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(([entry]) => {
            if (entry && entry.contentRect.width !== width) {
              width = entry.contentRect.width
              cancelAnimationFrame(frame)
              frame = requestAnimationFrame(resize)
            }
          })
    if (textarea.parentElement) observer?.observe(textarea.parentElement)
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [input, contextOpen, layout, textareaRef])

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
      inert={Boolean(learning?.isOpen && !layout.desktop)}
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
            <div className="composer-context">
              <ContextTextarea />
            </div>
          )}
          <div className="source-input-area">
            {(sourceSpans.length > 0 || sourceGrammar.length > 0) && (
              <SourceHighlight
                text={input}
                spans={sourceSpans}
                grammarHighlights={sourceGrammar}
                textareaRef={textareaRef}
                inspectionKey={learning?.identity}
                onInspect={
                  learning?.canOpen && learning.side === 'source'
                    ? (offset) => {
                        learning.openAt(offset, 'source')
                        if (!layout.desktop) textareaRef.current?.blur()
                      }
                    : undefined
                }
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
          </div>
          <div className="composer-meta">
            <ContextToggle
              open={contextOpen}
              onToggle={() => {
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
