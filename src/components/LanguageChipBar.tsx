import { useEffect, useRef, useState } from 'react'
import { LANGUAGES } from '../lib/languages'
import type { LangCode } from '../lib/languages'
import { usePersistentState } from '../lib/usePersistentState'
import { useUiLang } from '../hooks/useUiLang'
import Pill from './ui/Pill'
import Select from './ui/Select'

type Kind = 'source' | 'target'

type Props = {
  kind: Kind
  value: LangCode
  onChange: (v: LangCode) => void
  /** Auto-detected language shown inline on the Auto chip (source bar only). */
  detected?: LangCode | null
  'aria-label'?: string
}

const FIXED: Record<Kind, ReadonlyArray<LangCode>> = {
  source: ['auto', 'en', 'ko'],
  target: ['en', 'ko'],
}

const labelFor = (code: LangCode) =>
  LANGUAGES.find((l) => l.code === code)?.label ?? code

export default function LanguageChipBar({
  kind,
  value,
  onChange,
  detected,
  'aria-label': ariaLabel,
}: Props) {
  const { t } = useUiLang()
  const fixed = FIXED[kind]
  const [recent, setRecent] = usePersistentState<LangCode | null>(
    kind === 'source' ? 'nt.recentSource' : 'nt.recentTarget',
    null,
  )
  const barRef = useRef<HTMLDivElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  // Measure the space left after toolbar actions. Viewport width alone cannot
  // describe a panel inside columns, split windows, or a folded display.
  useEffect(() => {
    if (!barRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setIsExpanded(entry.contentRect.width >= (kind === 'source' ? 448 : 320))
    })
    observer.observe(barRef.current)
    return () => observer.disconnect()
  }, [kind])

  // A language picked from the "more" dropdown earns a persistent 4th chip so
  // it stays one click away next time.
  useEffect(() => {
    if (!fixed.includes(value) && value !== recent) setRecent(value)
  }, [value, recent, fixed, setRecent])

  const expandedChips: ReadonlyArray<LangCode> =
    recent && !fixed.includes(recent) ? [...fixed, recent] : fixed
  // Collapsed (narrow panel): only the active language stays a chip; every
  // other choice moves into the ⋯ listbox — including `auto` for the source.
  const chips: ReadonlyArray<LangCode> = isExpanded ? expandedChips : [value]
  const moreOptions = LANGUAGES.filter(
    (l) => (kind === 'source' || l.code !== 'auto') && !chips.includes(l.code),
  ).map((l) => ({ value: l.code, label: l.label, searchLabel: l.promptName }))
  const moreSelected = !chips.includes(value)

  return (
    <div
      ref={barRef}
      role="group"
      aria-label={ariaLabel}
      className="flex min-w-0 flex-1 items-center gap-1.5"
    >
      <div className="language-chip-scroll flex min-w-0 items-center gap-1.5 overflow-x-auto">
        {chips.map((code) => {
          const selected = value === code
          return (
            <Pill
              key={code}
              size="md"
              tone={selected ? 'active' : 'neutral'}
              aria-pressed={selected}
              data-testid="lang-chip"
              data-value={code}
              className="px-2!"
              onClick={() => onChange(code)}
            >
              {code === 'auto' && selected && detected ? (
                <>
                  {labelFor('auto')}
                  <span className="text-ink-dim">·</span>
                  <span>{labelFor(detected)}</span>
                </>
              ) : (
                labelFor(code)
              )}
            </Pill>
          )
        })}
      </div>
      <Select
        value={value}
        onChange={onChange}
        options={moreOptions}
        size="md"
        tone={moreSelected ? 'active' : 'neutral'}
        placeholder="⋯"
        showChevron={false}
        aria-label={t('moreLanguages')}
        data-testid="lang-more-trigger"
      />
    </div>
  )
}
