import { forwardRef } from 'react'
import { X } from 'lucide-react'
import CopyButton from './CopyButton'
import KoreanInsight from './KoreanInsight'
import LanguageSelect from './LanguageSelect'
import WordSourceMeta from './WordSourceMeta'
import type { LangCode } from '../lib/languages'
import type { Intent } from '../lib/detectIntent'
import type { LiveResult } from '../hooks/useTranslate'
import type { KoreanInsight as KoreanInsightType } from '../server/schemas'

type Props = {
  input: string
  setInput: (next: string) => void
  source: LangCode
  setSource: (next: LangCode) => void
  intent: Intent
  live: LiveResult | null
  streaming: boolean
  error: string | null
  koreanInsight?: Partial<KoreanInsightType>
  onSubmit: () => void
  onClear: () => void
  onLookup: (text: string) => void
}

const InputPanel = forwardRef<HTMLTextAreaElement, Props>(
  function InputPanelImpl(
    {
      input,
      setInput,
      source,
      setSource,
      intent,
      live,
      streaming,
      error,
      koreanInsight,
      onSubmit,
      onClear,
      onLookup,
    },
    ref,
  ) {
    return (
      <section className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 text-sm text-ink-soft sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSelect value={source} onChange={setSource} includeAuto />
            {input && <CopyButton text={input} />}
            <KoreanInsight insight={koreanInsight} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-dim">
              {intent === 'word' ? 'Dictionary' : 'Sentence'}
            </span>
            {input && (
              <button
                type="button"
                onClick={onClear}
                title="Clear input  Esc"
                aria-label="Clear input"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-panel text-ink-soft transition hover:border-accent/60 hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
          <div className="relative flex flex-col">
            <textarea
              ref={ref}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.metaKey &&
                  !e.ctrlKey
                ) {
                  e.preventDefault()
                  onSubmit()
                }
              }}
              placeholder="Type or paste text…"
              className="field-sizing-content min-h-[7rem] w-full resize-none bg-transparent px-4 py-3 text-lg leading-relaxed text-ink placeholder:text-ink-dim focus:outline-none scrollbar-thin sm:px-6 sm:py-4 sm:text-xl"
              spellCheck={false}
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
                className="absolute left-48 text-sm top-4 sm:left-55 sm:top-5 text-ink-dim cursor-pointer underline decoration-dotted underline-offset-4 transition hover:text-ink  sm:text-base"
              >
                Paste clipboard
              </button>
            )}
          </div>
          {!error && live?.intent === 'word' && (
            <WordSourceMeta
              result={live.partial}
              streaming={streaming}
              onLookup={onLookup}
            />
          )}
        </div>
      </section>
    )
  },
)

export default InputPanel
