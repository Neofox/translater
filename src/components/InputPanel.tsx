import { X } from 'lucide-react'
import CopyButton from './CopyButton'
import LearningTips from './LearningTips'
import LanguageSelect from './LanguageSelect'
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
    intent,
    isPolish,
    live,
    streaming,
    error,
    inputTips,
    clearInput,
    lookupWord,
    textareaRef,
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
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 text-sm text-ink-soft sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <LanguageSelect
            value={source}
            onChange={setSource}
            includeAuto
            polish={isPolish}
            aria-label={t('sourceLanguage')}
          />
          {input && <CopyButton text={input} />}
          <LearningTips tips={inputTips} />
        </div>
        <div className="flex items-center gap-2">
          {showCounter && (
            <span
              className={`text-xs font-medium tabular-nums ${counterTone}`}
              aria-live="polite"
            >
              {counterText}
            </span>
          )}
          {input && !overLimit && (
            <span
              className={`text-xs font-medium ${intent === 'word' ? 'text-warm' : 'text-accent'}`}
            >
              {intent === 'word' ? t('intentWord') : t('intentSentence')}
            </span>
          )}
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
                  if (text) setInput(text)
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
