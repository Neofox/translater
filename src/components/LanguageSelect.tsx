import { LANGUAGES } from '../lib/languages'
import type { LangCode } from '../lib/languages'

type Props = {
  value: LangCode
  onChange: (v: LangCode) => void
  includeAuto?: boolean
  'aria-label'?: string
}

export default function LanguageSelect({
  value,
  onChange,
  includeAuto = false,
  'aria-label': ariaLabel,
}: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as LangCode)}
      aria-label={ariaLabel}
      className="cursor-pointer rounded-md border border-border/70 bg-panel/40 px-2.5 py-1.5 text-sm font-medium text-ink transition hover:border-accent/60 hover:bg-panel focus:border-accent focus:bg-panel focus:outline-none"
    >
      {LANGUAGES.filter((l) => includeAuto || l.code !== 'auto').map((l) => (
        <option key={l.code} value={l.code} className="bg-panel text-ink">
          {l.label}
        </option>
      ))}
    </select>
  )
}
