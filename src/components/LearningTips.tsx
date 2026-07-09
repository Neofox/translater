import { useState } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import { ChevronDown } from 'lucide-react'
import type { LearningTips as LearningTipsType } from '../server/schemas'
import Pill from './ui/Pill'
import { useUiLang } from '../hooks/useUiLang'
import type { StringKey } from '../lib/i18n'

type Props = {
  tips?: Partial<LearningTipsType>
}

// Pick a learner-friendly label key for the character breakdown based on the
// script of the first word. Korean hanja (Hangul word + Hanja chars), Japanese
// kanji (kanji/mixed word), Chinese hanzi (Han-only word).
function characterLabelKey(word: string | undefined): StringKey {
  if (!word) return 'characters'
  if (/[\uAC00-\uD7AF]/.test(word)) return 'hanja'
  if (/[\u3040-\u30FF]/.test(word)) return 'kanji'
  if (/[\u4E00-\u9FFF]/.test(word)) return 'hanzi'
  return 'characters'
}

export default function LearningTips({ tips }: Props) {
  const { t } = useUiLang()
  const [open, setOpen] = useState(false)

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset({ mainAxis: 8 }),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.min(availableWidth, 448)}px`,
            maxHeight: `${availableHeight}px`,
          })
        },
        padding: 8,
      }),
    ],
  })

  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ])

  const grammar = tips?.grammar?.trim() ?? ''
  const vocab = tips?.vocab?.trim() ?? ''
  const characters = (tips?.characters ?? []).filter(
    (c) => c.word && Array.isArray(c.chars) && c.chars.length > 0,
  )

  if (!grammar && !vocab && characters.length === 0) return null

  const charLabel = t(characterLabelKey(characters[0]?.word))

  return (
    <>
      <Pill
        ref={refs.setReference}
        tone="warm"
        size="md"
        aria-expanded={open}
        {...getReferenceProps()}
      >
        <span>{t('learningTips')}</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </Pill>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              visibility: isPositioned ? 'visible' : 'hidden',
            }}
            {...getFloatingProps()}
            className="z-50 w-max space-y-1.5 overflow-auto rounded-lg border border-border bg-panel px-3 py-2 text-xs text-ink-soft shadow-lg scrollbar-thin"
          >
            {grammar && (
              <p>
                <span className="mr-1 font-semibold uppercase tracking-wide text-warm">
                  {t('grammar')} ·
                </span>
                {grammar}
              </p>
            )}
            {vocab && (
              <p>
                <span className="mr-1 font-semibold uppercase tracking-wide text-warm">
                  {t('vocab')} ·
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
        </FloatingPortal>
      )}
    </>
  )
}
