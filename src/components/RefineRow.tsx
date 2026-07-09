import { useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import Pill from './ui/Pill'
import Tag from './ui/Tag'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { MAX_REFINEMENT_CHARS } from '../lib/limits'
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

export default function RefineRow() {
  const {
    live,
    streaming,
    error,
    refinements,
    addRefinement,
    removeRefinement,
    undoRefine,
    canUndo,
  } = useTranslatorContext()
  const { t } = useUiLang()
  const [freeform, setFreeform] = useState('')

  // Only meaningful under a completed sentence result.
  if (error || streaming) return null
  if (!live || live.intent !== 'sentence' || !live.done) return null

  const submitFreeform = () => {
    const trimmed = freeform.trim()
    if (!trimmed) return
    addRefinement(trimmed)
    setFreeform('')
  }

  return (
    <div className="shrink-0 border-t border-border px-4 py-2 sm:px-6">
      {refinements.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {refinements.map((r, i) => (
            <button
              key={r}
              type="button"
              onClick={() => removeRefinement(i)}
              data-testid={`refine-active-${i}`}
              className="cursor-pointer"
            >
              <Tag tone="accent" className="inline-flex items-center gap-1">
                {r}
                <X size={10} />
              </Tag>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {CHIPS.filter((c) => !refinements.includes(c.instruction)).map((c) => (
          <Pill
            key={c.id}
            size="sm"
            tone="accent"
            onClick={() => addRefinement(c.instruction)}
            data-testid={`refine-chip-${c.id}`}
          >
            {t(c.labelKey)}
          </Pill>
        ))}
        <input
          value={freeform}
          maxLength={MAX_REFINEMENT_CHARS}
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
          className="min-w-32 flex-1 bg-transparent px-2 py-1 text-xs text-ink placeholder:text-ink-dim focus:outline-none"
        />
        {canUndo && (
          <Pill
            size="sm"
            tone="accent"
            onClick={undoRefine}
            data-testid="refine-undo"
          >
            <RotateCcw size={12} />
            {t('refineUndo')}
          </Pill>
        )}
      </div>
    </div>
  )
}
