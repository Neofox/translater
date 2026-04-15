import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { LearningTips as LearningTipsType } from '../server/schemas'
import Pill from './ui/Pill'

type Props = {
  tips?: Partial<LearningTipsType>
  align?: 'start' | 'end'
}

// Pick a learner-friendly label for the character breakdown based on the script
// of the first word. Korean hanja (Hangul word + Hanja chars), Japanese kanji
// (kanji/mixed word), Chinese hanzi (Han-only word). Fallback: "characters".
function characterLabel(word: string | undefined): string {
  if (!word) return 'characters'
  if (/[\uAC00-\uD7AF]/.test(word)) return 'hanja'
  if (/[\u3040-\u30FF]/.test(word)) return 'kanji'
  if (/[\u4E00-\u9FFF]/.test(word)) {
    // Han-only — could be Japanese kanji or Chinese hanzi. Default to hanzi;
    // Japanese single-kanji words are rare and the distinction isn't critical.
    return 'hanzi'
  }
  return 'characters'
}

export default function LearningTips({ tips, align = 'start' }: Props) {
  const [open, setOpen] = useState(false)

  const grammar = tips?.grammar?.trim() ?? ''
  const vocab = tips?.vocab?.trim() ?? ''
  const characters = (tips?.characters ?? []).filter(
    (c) => c.word && c.chars.length > 0,
  )

  if (!grammar && !vocab && characters.length === 0) return null

  const charLabel = characterLabel(characters[0]?.word)

  return (
    <div className={`animate-settle relative ${open ? 'z-50' : ''}`}>
      <Pill tone="warm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>Learning tips</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </Pill>

      {open && (
        <div
          className={`absolute top-full z-50 mt-2 w-[min(28rem,calc(100vw-2rem))] space-y-1.5 rounded-lg border border-border bg-panel px-3 py-2 text-xs text-ink-soft shadow-lg ${
            align === 'end' ? 'left-0 md:left-auto md:right-0' : 'left-0'
          }`}
        >
          {grammar && (
            <p>
              <span className="mr-1 font-semibold uppercase tracking-wide text-warm">
                grammar ·
              </span>
              {grammar}
            </p>
          )}
          {vocab && (
            <p>
              <span className="mr-1 font-semibold uppercase tracking-wide text-warm">
                vocab ·
              </span>
              {vocab}
            </p>
          )}
          {characters.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold uppercase tracking-wide text-warm">
                {charLabel} ·
              </span>
              {characters.map((c, i) => (
                <span
                  key={`${c.word}-${i}`}
                  className="inline-flex items-baseline gap-1"
                >
                  <span className="font-medium text-warm">{c.word}</span>
                  <span className="text-ink-dim">
                    {c.chars.map((ch, j) => (
                      <span key={`${ch.char}-${j}`}>
                        {j > 0 && <span className="mx-0.5">·</span>}
                        <span className="text-ink-soft">{ch.char}</span>
                        <span className="ml-0.5">({ch.meaning})</span>
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
