import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

type Tone = 'neutral' | 'accent' | 'warm' | 'active'
type Size = 'sm' | 'md'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  tone?: Tone
  size?: Size
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}

const toneClass: Record<Tone, string> = {
  neutral: 'border-border bg-panel hover:border-accent/60',
  accent: 'border-border bg-panel hover:border-accent/60 [&>svg]:text-accent',
  warm: 'border-border bg-panel hover:border-warm/60 [&>svg]:text-warm',
  active: 'border-accent/70 bg-accent-soft [&>svg]:text-accent',
}

const sizeClass: Record<Size, string> = {
  sm: 'gap-1.5 px-2 py-1 text-xs',
  // min-h keeps icon-only pills (copy, clear) as tall as text pills: a 14px
  // svg doesn't establish the 20px text-sm line-height, so they'd render 28px
  // instead of the 34px a labeled md pill computes to.
  md: 'gap-2 px-3 py-1.5 text-sm min-h-8.5',
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
      className={`inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border text-ink transition ${toneClass[tone]} ${sizeClass[size]} ${className}`}
    >
      {children}
    </button>
  )
}
