import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Tone = 'neutral' | 'accent' | 'warm'
type Size = 'sm' | 'md'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  tone?: Tone
  size?: Size
  children: ReactNode
}

const toneClass: Record<Tone, string> = {
  neutral: 'hover:border-accent/60',
  accent: 'hover:border-accent/60 [&>svg]:text-accent',
  warm: 'hover:border-warm/60 [&>svg]:text-warm',
}

const sizeClass: Record<Size, string> = {
  sm: 'gap-1.5 px-2 py-1 text-xs',
  md: 'gap-2 px-3 py-1.5 text-sm',
}

export default function Pill({
  tone = 'neutral',
  size = 'sm',
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center rounded-md border border-border bg-panel text-ink transition ${toneClass[tone]} ${sizeClass[size]} ${className}`}
    >
      {children}
    </button>
  )
}
