import { forwardRef } from 'react'
import { X } from 'lucide-react'
import LanguageSelect from './LanguageSelect'
import WordSourceMeta from './WordSourceMeta'
import type { LangCode } from '../lib/languages'
import type { Intent } from '../lib/detectIntent'
import type { LiveResult } from '../hooks/useTranslate'

type Props = {
  input: string
  setInput: (next: string) => void
  source: LangCode
  setSource: (next: LangCode) => void
  intent: Intent
  live: LiveResult | null
  error: string | null
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
      error,
      onSubmit,
      onClear,
      onLookup,
    },
    ref,
  ) {
    return (
      <section className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-ink-soft sm:px-4">
          <LanguageSelect value={source} onChange={setSource} includeAuto />
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
        <textarea
          ref={ref}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
          placeholder="Type or paste text…"
          className="min-h-[7rem] w-full flex-1 resize-none bg-transparent px-4 py-3 text-lg leading-relaxed text-ink placeholder:text-ink-dim focus:outline-none scrollbar-thin sm:min-h-[40%] sm:px-6 sm:py-4 sm:text-xl"
          spellCheck={false}
        />
        {!error && live?.intent === 'word' && (
          <WordSourceMeta result={live.partial} onLookup={onLookup} />
        )}
      </section>
    )
  },
)

export default InputPanel
