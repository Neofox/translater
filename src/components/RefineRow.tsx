import { useState } from 'react'
import Pill from './ui/Pill'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { MAX_REFINEMENTS, MAX_REFINEMENT_CHARS } from '../lib/limits'
import type { StringKey } from '../lib/i18n'

// Instructions are fixed English strings (model-facing); labels localize.
const CHIPS: Array<{ id: string; instruction: string; labelKey: StringKey }> = [
  { id: 'softer', instruction: 'make it softer', labelKey: 'refineSofter' },
  {
    id: 'direct',
    instruction: 'make it more direct',
    labelKey: 'refineMoreDirect',
  },
  { id: 'shorter', instruction: 'make it shorter', labelKey: 'refineShorter' },
  {
    id: 'playful',
    instruction: 'make it more playful',
    labelKey: 'refineMorePlayful',
  },
]

const CHIP_INSTRUCTIONS = new Set(CHIPS.map((c) => c.instruction))

const CUSTOM_LABEL_MAX = 20

export default function RefineRow() {
  const {
    live,
    streaming,
    error,
    refineError,
    input,
    refinements,
    addRefinement,
    removeRefinement,
  } = useTranslatorContext()
  const { t } = useUiLang()
  const [freeform, setFreeform] = useState('')

  // Only meaningful under a completed sentence result.
  if (error || streaming) return null
  if (!live || live.intent !== 'sentence' || !live.done) return null
  // `live` outlives input edits during the debounce window — don't show
  // refine controls for a result that no longer matches the current input.
  if (live.text !== input.trim()) return null

  // Chips are toggles: tapping an active chip removes its adjustment. The
  // free-text field allows a single custom adjustment at a time; once set it
  // renders as an active button (tap to remove and get the field back).
  const custom = refinements.find((r) => !CHIP_INSTRUCTIONS.has(r))
  const atCap = refinements.length >= MAX_REFINEMENTS

  const toggle = (instruction: string) => {
    const idx = refinements.indexOf(instruction)
    if (idx >= 0) removeRefinement(idx)
    else addRefinement(instruction)
  }

  const submitFreeform = () => {
    const trimmed = freeform.trim()
    if (!trimmed || atCap || custom) return
    addRefinement(trimmed)
    setFreeform('')
  }

  return (
    <div className="refine-row">
      {refineError && (
        <p data-testid="refine-error" className="mb-2 text-xs text-red-400">
          {t('refineFailed')}: {refineError.message}
        </p>
      )}
      <div className="refine-controls">
        {CHIPS.map((c) => {
          const active = refinements.includes(c.instruction)
          return (
            <Pill
              key={c.id}
              size="sm"
              tone={active ? 'active' : 'accent'}
              onClick={() => toggle(c.instruction)}
              disabled={!active && atCap}
              aria-pressed={active}
              data-testid={`refine-chip-${c.id}`}
              className="disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t(c.labelKey)}
            </Pill>
          )
        })}
        {custom ? (
          <Pill
            size="sm"
            tone="active"
            onClick={() => removeRefinement(refinements.indexOf(custom))}
            aria-pressed
            aria-label={`${t('refineRemove')}: ${custom}`}
            title={custom}
            data-testid="refine-custom"
          >
            {custom.length > CUSTOM_LABEL_MAX
              ? `${custom.slice(0, CUSTOM_LABEL_MAX)}…`
              : custom}
          </Pill>
        ) : (
          <input
            value={freeform}
            maxLength={MAX_REFINEMENT_CHARS}
            disabled={atCap}
            onChange={(e) => setFreeform(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submitFreeform()
              }
            }}
            placeholder={t('refinePlaceholder')}
            aria-label={t('refinePlaceholder')}
            data-testid="refine-freeform"
            className="refine-freeform min-w-32 flex-1 bg-transparent px-2 py-1 text-xs text-ink placeholder:text-ink-dim focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          />
        )}
      </div>
    </div>
  )
}
