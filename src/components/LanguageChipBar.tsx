import { useEffect, useRef, useState } from 'react'
import { LANGUAGES } from '../lib/languages'
import type { LangCode } from '../lib/languages'
import { usePreference } from '../context/PreferencesContext'
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
  const [recent, setRecent] = usePreference(
    kind === 'source' ? 'recentSource' : 'recentTarget',
  )
  const barRef = useRef<HTMLDivElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  // CSS chooses the visible chips before hydration. Measure only to keep the
  // portalled menu in sync with those chips after a panel resize.
  useEffect(() => {
    if (!barRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setIsExpanded(entry.contentRect.width >= (kind === 'source' ? 320 : 280))
    })
    observer.observe(barRef.current)
    return () => observer.disconnect()
  }, [kind])

  // A language picked from the "more" dropdown earns a persistent 4th chip so
  // it stays one click away next time.
  useEffect(() => {
    if (!fixed.includes(value) && value !== recent) setRecent(value)
  }, [value, recent, fixed, setRecent])

  const promoted = !fixed.includes(value) ? value : recent
  const chips: ReadonlyArray<LangCode> =
    promoted && !fixed.includes(promoted) ? [...fixed, promoted] : fixed
  const menuChips: ReadonlyArray<LangCode> = isExpanded ? chips : [value]
  const moreOptions = LANGUAGES.filter(
    (l) =>
      (kind === 'source' || l.code !== 'auto') && !menuChips.includes(l.code),
  ).map((l) => ({ value: l.code, label: l.label, searchLabel: l.promptName }))

  return (
    <div
      ref={barRef}
      role="group"
      aria-label={ariaLabel}
      data-kind={kind}
      className="language-chip-bar flex min-w-0 flex-1 items-center gap-1.5"
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
              aria-label={
                code === 'auto' && selected && detected
                  ? `${labelFor('auto')} · ${labelFor(detected)}`
                  : labelFor(code)
              }
              className="language-chip"
              onClick={() => onChange(code)}
            >
              <span className="sr-only">
                {labelFor(code)}
                {code === 'auto' && selected && detected
                  ? ` · ${labelFor(detected)}`
                  : ''}
              </span>
              <span aria-hidden>
                {code === 'auto'
                  ? `Auto${selected && detected ? `·${detected.toUpperCase()}` : ''}`
                  : code.toUpperCase()}
              </span>
            </Pill>
          )
        })}
      </div>
      <Select
        value={value}
        onChange={onChange}
        options={moreOptions}
        size="md"
        tone="neutral"
        placeholder={t('moreLabel')}
        showChevron
        aria-label={t('moreLanguages')}
        data-testid="lang-more-trigger"
      />
    </div>
  )
}
