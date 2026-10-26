import { useEffect, useLayoutEffect, useState } from 'react'
import { Clipboard, X } from 'lucide-react'
import Pill from './ui/Pill'
import LanguageChipBar from './LanguageChipBar'
import { ContextTextarea, ContextToggle } from './ContextField'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useUiLang } from '../hooks/useUiLang'
import { INPUT_WARN_THRESHOLD, MAX_INPUT_CHARS } from '../lib/limits'
import { STRINGS } from '../lib/i18n'
import { useKbd } from '../hooks/useKbd'

export default function InputPanel() {
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
  const { mod } = useKbd()
  const [contextOpen, setContextOpen] = useState(false)
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
  }, [input, contextOpen, layout, textareaRef])

  const overLimit = input.length > MAX_INPUT_CHARS
  const showLimit = input.length >= INPUT_WARN_THRESHOLD
  const count = (showLimit ? STRINGS[lang].charCount : STRINGS[lang].inputCount)
    .replace('{count}', String(input.length))
    .replace('{max}', String(MAX_INPUT_CHARS))
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        queueImmediate('paste')
        setInput(text)
        textareaRef.current?.focus({ preventScroll: true })
      }
    } catch {
      /* Keep the current draft when clipboard access is unavailable. */
    }
  }

  return (
    <section className="input-panel" aria-label={t('sourceText')}>
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
        {contextOpen && (
          <div className="composer-context">
            <ContextTextarea />
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
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
            onClick={clearInput}
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
            onToggle={() => setContextOpen((value) => !value)}
          />
          <span
            className={`input-count ${showLimit ? 'input-count-visible' : ''} ${overLimit ? 'text-red-400' : 'text-ink-dim'}`}
            aria-live={showLimit ? 'polite' : undefined}
          >
            {count}
          </span>
          <kbd className="composer-shortcut">{mod}↵</kbd>
        </div>
      </div>
    </section>
  )
}
