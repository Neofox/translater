import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { KoreanInsight as KoreanInsightType } from '../server/schemas'

type Props = {
  insight?: Partial<KoreanInsightType>
}

export default function KoreanInsight({ insight }: Props) {
  const [open, setOpen] = useState(false)

  const grammar = insight?.grammar?.trim() ?? ''
  const vocab = insight?.vocab?.trim() ?? ''
  const hanja = (insight?.hanja ?? []).filter(
    (h) => h?.word && h.chars && h.chars.length > 0,
  )

  if (!grammar && !vocab && hanja.length === 0) return null

  return (
    <div className={`animate-settle relative ${open ? 'z-50' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-2 py-1 text-xs text-ink-soft transition hover:border-accent/60 hover:text-ink"
      >
        <span>📚 Korean insight</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(28rem,calc(100vw-2rem))] space-y-1.5 rounded-lg border border-border bg-panel px-3 py-2 text-xs text-ink-soft shadow-lg">
          {grammar && (
            <p>
              <span className="mr-1 font-semibold uppercase tracking-wide text-ink-dim">
                grammar ·
              </span>
              {grammar}
            </p>
          )}
          {vocab && (
            <p>
              <span className="mr-1 font-semibold uppercase tracking-wide text-ink-dim">
                vocab ·
              </span>
              {vocab}
            </p>
          )}
          {hanja.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold uppercase tracking-wide text-ink-dim">
                hanja ·
              </span>
              {hanja.map((h, i) => (
                <span
                  key={`${h.word}-${i}`}
                  className="inline-flex items-baseline gap-1"
                >
                  <span className="text-ink">{h.word}</span>
                  <span className="text-ink-dim">
                    {h.chars.map((c, j) => (
                      <span key={`${c.char}-${j}`}>
                        {j > 0 && <span className="mx-0.5">·</span>}
                        <span className="text-ink-soft">{c.char}</span>
                        <span className="ml-0.5">({c.meaning})</span>
                      </span>
                    ))}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
