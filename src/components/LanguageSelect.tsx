import { LANGUAGES } from '../lib/languages'
import type { LangCode } from '../lib/languages'
import Select from './ui/Select'

type Props = {
  value: LangCode
  onChange: (v: LangCode) => void
  includeAuto?: boolean
  polish?: boolean
  'aria-label'?: string
}

export default function LanguageSelect({
  value,
  onChange,
  includeAuto = false,
  polish = false,
  'aria-label': ariaLabel,
}: Props) {
  const options = LANGUAGES.filter((l) => includeAuto || l.code !== 'auto').map(
    (l) => ({ value: l.code, label: l.label, searchLabel: l.promptName }),
  )

  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      tone={polish ? 'active' : 'neutral'}
      aria-label={ariaLabel}
    />
  )
}
