import type { ReactNode } from 'react'
import CopyButton from './CopyButton'

type Props = {
  text?: string
  note?: string
  index: number
  children?: ReactNode
}

export default function AlternativeItem({
  text,
  note,
  index,
  children,
}: Props) {
  return (
    <li
      className="animate-settle group flex items-start justify-between gap-3 rounded-lg border border-border bg-panel px-3 py-2"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="min-w-0 flex-1">
        {children ? (
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-base text-ink">{text}</p>
            {children}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-base text-ink">{text}</p>
        )}
        {note && <p className="text-xs text-ink-dim">{note}</p>}
      </div>
      {text && (
        <div className="shrink-0 opacity-60 transition group-hover:opacity-100">
          <CopyButton text={text} />
        </div>
      )}
    </li>
  )
}
