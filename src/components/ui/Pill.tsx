import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

type Tone = 'neutral' | 'accent' | 'warm' | 'active' | 'primary'
type Size = 'sm' | 'md'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  tone?: Tone
  size?: Size
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}

const toneClass: Record<Tone, string> = {
  primary: 'border-transparent bg-accent text-bg hover:brightness-110',
  neutral: 'border-border bg-panel hover:border-accent/60',
  accent: 'border-border bg-panel hover:border-accent/60 [&>svg]:text-accent',
  warm: 'border-border bg-panel hover:border-warm/60 [&>svg]:text-warm',
  active: 'border-accent/70 bg-accent-soft [&>svg]:text-accent',
}

const sizeClass: Record<Size, string> = {
  sm: 'gap-1.5 px-2 py-1 text-xs min-h-11 min-w-11',
  // Keep icon-only and labelled controls at the same 44px touch target.
  md: 'gap-2 px-3 py-1.5 text-sm min-h-11 min-w-11',
}

export default function Pill({
  tone = 'neutral',
  size = 'sm',
  className = '',
  children,
  ref,
  ...rest
}: Props) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`ui-pill inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border transition ${tone !== 'primary' ? 'text-ink' : ''} ${toneClass[tone]} ${sizeClass[size]} ${className}`}
    >
      {children}
    </button>
  )
}
