import { LANGUAGES } from '../lib/languages'
import type { LangCode } from '../lib/languages'

type Props = {
  value: LangCode
  onChange: (v: LangCode) => void
  includeAuto?: boolean
}

export default function LanguageSelect({
  value,
  onChange,
  includeAuto = false,
}: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as LangCode)}
      className="rounded-md bg-transparent px-2 py-1 text-sm font-medium text-ink hover:bg-panel focus:bg-panel focus:outline-none"
    >
      {LANGUAGES.filter((l) => includeAuto || l.code !== 'auto').map((l) => (
        <option key={l.code} value={l.code} className="bg-panel text-ink">
          {l.label}
        </option>
      ))}
    </select>
  )
}
