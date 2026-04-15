import type { Mode } from '../lib/types'
import { useUiLang } from '../hooks/useUiLang'
import type { StringKey } from '../lib/i18n'

type Props = {
  value: Mode
  onChange: (v: Mode) => void
}

const MODES: Mode[] = ['friends', 'casual', 'professional']

const MODE_KEY: Record<Mode, StringKey> = {
  friends: 'modeFriends',
  casual: 'modeCasual',
  professional: 'modeProfessional',
}

export default function ModeToggle({ value, onChange }: Props) {
  const { t } = useUiLang()
  return (
    <div className="inline-flex rounded-lg border border-border bg-panel p-0.5 text-sm">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`rounded-md px-3 py-1 transition ${
            value === m
              ? 'bg-accent-soft text-ink'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          {t(MODE_KEY[m])}
        </button>
      ))}
    </div>
  )
}
