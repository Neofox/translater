import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { REFINEMENT_CHIPS } from '../lib/refinements'
import RefineRow from './RefineRow'
import Pill from './ui/Pill'

export default function AdjustMenu() {
  const { live, input, refinements, refineError } = useTranslatorContext()
  const { t } = useUiLang()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (!input.trim()) setOpen(false)
  }, [input])
  if (!live || live.intent !== 'sentence') return null
  const summary = refinements
    .map((instruction) => {
      const chip = REFINEMENT_CHIPS.find((c) => c.instruction === instruction)
      return chip
        ? t(chip.labelKey)
        : instruction.length > 20
          ? `${instruction.slice(0, 20)}…`
          : instruction
    })
    .join(' · ')
  return (
    <div
      className="adjust-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <Pill
        ref={trigger}
        size="md"
        tone={summary ? 'active' : 'neutral'}
        aria-expanded={open}
        aria-controls={id}
        data-testid="adjust-button"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {t('adjust')}
          {summary ? ` · ${summary}` : ''}
        </span>
        <ChevronDown
          size={14}
          className={open ? 'rotate-180' : ''}
          aria-hidden
        />
      </Pill>
      <div id={id} hidden={!open} className="adjust-content">
        <RefineRow />
      </div>
      {!open && refineError && (
        <p className="adjust-error" role="alert">
          {t('refineFailed')}: {refineError.message}
        </p>
      )}
    </div>
  )
}
