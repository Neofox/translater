type Mode = 'friends' | 'casual' | 'professional'

type Props = {
  value: Mode
  onChange: (v: Mode) => void
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'friends', label: 'Friends' },
  { id: 'casual', label: 'Casual' },
  { id: 'professional', label: 'Professional' },
]

export default function ModeToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-panel p-0.5 text-sm">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          className={`rounded-md px-3 py-1 transition ${
            value === m.id
              ? 'bg-accent-soft text-ink'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
