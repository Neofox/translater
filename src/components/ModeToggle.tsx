import type { Mode } from '../lib/types'
import { useUiLang } from '../hooks/useUiLang'
import type { StringKey } from '../lib/i18n'

type Props = { value: Mode; onChange: (value: Mode) => void }
const MODES: Mode[] = ['friends', 'casual', 'professional']
const MODE_KEY: Record<Mode, StringKey> = {
  friends: 'modeFriends',
  casual: 'modeCasual',
  professional: 'modeProfessional',
}

export default function ModeToggle({ value, onChange }: Props) {
  const { t } = useUiLang()
  return (
    <>
      <div className="mode-segment" role="group" aria-label={t('tone')}>
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
          >
            {t(MODE_KEY[mode])}
          </button>
        ))}
      </div>
      <select
        className="mode-select"
        aria-label={t('tone')}
        value={value}
        onChange={(event) => onChange(event.target.value as Mode)}
      >
        {MODES.map((mode) => (
          <option key={mode} value={mode}>
            {t(MODE_KEY[mode])}
          </option>
        ))}
      </select>
    </>
  )
}
