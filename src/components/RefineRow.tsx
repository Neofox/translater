import { useLayoutEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import Pill from './ui/Pill'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { resultIsCurrent } from '../lib/liveResult'
import { MAX_REFINEMENTS, MAX_REFINEMENT_CHARS } from '../lib/limits'
import { REFINEMENT_CHIPS as CHIPS } from '../lib/refinements'

// Instructions are fixed English strings (model-facing); labels localize.
const CHIP_INSTRUCTIONS = new Set(CHIPS.map((c) => c.instruction))

const CUSTOM_LABEL_MAX = 20

export default function RefineRow({
  onCloseCustom,
}: { onCloseCustom?: () => void } = {}) {
  const {
    live,
    streaming,
    isPending,
    error,
    refineError,
    input,
    source,
    target,
    mode,
    context,
    refinements,
    addRefinement,
    removeRefinement,
  } = useTranslatorContext()
  const { t, lang } = useUiLang()
  const [freeform, setFreeform] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const freeformRef = useRef<HTMLInputElement>(null)
  const customTrigger = useRef<HTMLButtonElement>(null)
  const restoreAfterClose = useRef(false)
  useLayoutEffect(() => {
    if (!customOpen && restoreAfterClose.current) {
      restoreAfterClose.current = false
      if (onCloseCustom) onCloseCustom()
      else customTrigger.current?.focus()
    }
  }, [customOpen, onCloseCustom])

  if (error || !live || live.intent !== 'sentence') return null
  // Static controls keep their geometry; only a current, complete result can act.
  const ready =
    live.done &&
    !streaming &&
    !isPending &&
    resultIsCurrent(live, {
      text: input,
      source,
      target,
      mode,
      context,
      refinements,
      uiLang: lang,
    })

  // Chips are toggles: tapping an active chip removes its adjustment. The
  // free-text field allows a single custom adjustment at a time; once set it
  // renders as an active button (tap to remove and get the field back).
  const custom = refinements.find((r) => !CHIP_INSTRUCTIONS.has(r))
  const atCap = refinements.length >= MAX_REFINEMENTS

  const toggle = (instruction: string) => {
    if (!ready) return
    const idx = refinements.indexOf(instruction)
    if (idx >= 0) removeRefinement(idx)
    else addRefinement(instruction)
  }

  const submitFreeform = () => {
    const trimmed = freeform.trim()
    if (!ready || !trimmed || atCap || custom) return
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
        <span className="refine-label">{t('refineLabel')}</span>
        {CHIPS.map((c) => {
          const active = refinements.includes(c.instruction)
          return (
            <Pill
              key={c.id}
              size="sm"
              tone={active ? 'active' : 'accent'}
              onClick={() => toggle(c.instruction)}
              disabled={!ready || (!active && atCap)}
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
            onClick={() => {
              removeRefinement(refinements.indexOf(custom))
              setCustomOpen(true)
            }}
            aria-pressed
            disabled={!ready}
            aria-label={`${t('refineRemove')}: ${custom}`}
            title={custom}
            data-testid="refine-custom"
          >
            {custom.length > CUSTOM_LABEL_MAX
              ? `${custom.slice(0, CUSTOM_LABEL_MAX)}…`
              : custom}
          </Pill>
        ) : (
          <>
            <Pill
              ref={customTrigger}
              size="sm"
              tone={customOpen ? 'active' : 'neutral'}
              className="refine-custom-trigger"
              aria-expanded={customOpen}
              disabled={!ready || atCap}
              onClick={() => {
                setCustomOpen(!customOpen)
                if (!customOpen)
                  requestAnimationFrame(() => freeformRef.current?.focus())
              }}
              data-testid="refine-custom-trigger"
            >
              <Plus size={16} aria-hidden />
              {t('refineCustom')}
            </Pill>
            <div className="refine-custom-editor" hidden={!customOpen}>
              <input
                ref={freeformRef}
                hidden={!customOpen}
                value={freeform}
                maxLength={MAX_REFINEMENT_CHARS}
                disabled={!ready || atCap}
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
              <Pill
                size="sm"
                tone="accent"
                data-testid="refine-apply"
                disabled={!ready || atCap || !freeform.trim()}
                onClick={submitFreeform}
              >
                {t('refineApply')}
              </Pill>
              <Pill
                size="sm"
                aria-label={t('refineClose')}
                title={t('refineClose')}
                data-testid="refine-close"
                onClick={() => {
                  restoreAfterClose.current = true
                  setCustomOpen(false)
                }}
              >
                <X size={18} aria-hidden />
              </Pill>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
