import { X } from 'lucide-react'
import CopyButton from './CopyButton'
import LearningTips from './LearningTips'
import LanguageChipBar from './LanguageChipBar'
import WordSourceMeta from './WordSourceMeta'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { INPUT_WARN_THRESHOLD, MAX_INPUT_CHARS } from '../lib/limits'
import { STRINGS } from '../lib/i18n'

export default function InputPanel() {
  const {
    input,
    setInput,
    source,
    setSource,
    detected,
    live,
    streaming,
    error,
    inputTips,
    clearInput,
    lookupWord,
    textareaRef,
    flush,
    queueImmediate,
  } = useTranslatorContext()
  const { t, lang } = useUiLang()

  const charCount = input.length
  const showCounter = charCount >= INPUT_WARN_THRESHOLD
  const overLimit = charCount > MAX_INPUT_CHARS
  const counterText = STRINGS[lang].charCount
    .replace('{count}', String(charCount))
    .replace('{max}', String(MAX_INPUT_CHARS))
  const counterTone = overLimit
    ? 'text-red-400'
    : charCount >= MAX_INPUT_CHARS * 0.95
      ? 'text-warm'
      : 'text-ink-dim'

  return (
    <section className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r xl:p-6 2xl:p-12">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-ink-soft sm:px-4">
        <LanguageChipBar
          kind="source"
          value={source}
          onChange={setSource}
          detected={detected}
          aria-label={t('sourceLanguage')}
        />
        <div className="flex items-center gap-2">
          <LearningTips tips={inputTips} />
          {showCounter && (
            <span
              className={`text-xs font-medium tabular-nums ${counterTone}`}
              aria-live="polite"
            >
              {counterText}
            </span>
          )}
          {input && <CopyButton text={input} compact />}
          {input && (
            <button
              type="button"
              onClick={clearInput}
              title={t('clearInputTitle')}
              aria-label={t('clearInput')}
              data-testid="clear-input"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border bg-panel text-ink transition hover:border-accent/60"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 cursor-text flex-col overflow-y-auto scrollbar-thin"
        onClick={(e) => {
          if (e.target === e.currentTarget) textareaRef.current?.focus()
        }}
      >
        <div
          className="relative flex flex-col"
          onClick={(e) => {
            if (e.target === e.currentTarget) textareaRef.current?.focus()
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={() => queueImmediate()}
            onBlur={() => flush()}
            onKeyDown={(e) => {
              // Enter fires a pending debounced translation immediately;
              // when nothing is pending it stays a plain newline.
              // Shift+Enter always inserts a newline; Cmd/Ctrl+Enter is the
              // global force-run shortcut. Skip mid-IME-composition Enter
              // (Korean/Japanese input commits the composition with Enter).
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.metaKey &&
                !e.ctrlKey &&
                !e.nativeEvent.isComposing &&
                flush()
              ) {
                e.preventDefault()
              }
            }}
            placeholder={t('placeholder')}
            aria-label={t('inputText')}
            data-testid="input-textarea"
            className="field-sizing-content min-h-[7rem] w-full resize-none bg-transparent px-4 py-3 text-lg leading-relaxed text-ink placeholder:text-ink-dim focus:outline-none scrollbar-thin sm:px-6 sm:py-4 sm:text-xl"
            spellCheck
            autoComplete="off"
            autoCorrect="on"
          />
          {!input && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText()
                  if (text) {
                    queueImmediate()
                    setInput(text)
                  }
                } catch {
                  // clipboard unavailable or permission denied
                }
              }}
              className="absolute left-35 text-sm top-4 sm:left-40 sm:top-5 text-ink-dim cursor-pointer underline decoration-dotted underline-offset-4 transition hover:text-ink  sm:text-base"
            >
              {t('pasteClipboard')}
            </button>
          )}
        </div>
        {!error && live?.intent === 'word' && (
          <WordSourceMeta
            result={live.partial}
            streaming={streaming}
            onLookup={lookupWord}
          />
        )}
      </div>
    </section>
  )
}
