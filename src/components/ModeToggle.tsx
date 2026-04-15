import { MODE_LABEL } from '../lib/types'
import type { Mode } from '../lib/types'

type Props = {
  value: Mode
  onChange: (v: Mode) => void
}

const MODES: Mode[] = ['friends', 'casual', 'professional']

export default function ModeToggle({ value, onChange }: Props) {
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
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  )
}
