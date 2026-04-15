import type { ReactNode } from 'react'

type Tone = 'neutral' | 'accent' | 'warm'

type Props = {
  tone?: Tone
  children: ReactNode
  className?: string
}

const toneClass: Record<Tone, string> = {
  neutral: 'bg-bg text-ink-dim',
  accent: 'bg-accent-soft text-ink',
  warm: 'bg-warm-soft text-ink',
}

export default function Tag({
  tone = 'neutral',
  children,
  className = '',
}: Props) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneClass[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
