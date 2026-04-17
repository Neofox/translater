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
      className="animate-settle group rounded-lg border border-border bg-panel px-3 py-2"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {text && (
        <div className="float-right ml-2 transition sm:opacity-60 sm:group-hover:opacity-100">
          <CopyButton text={text} compact />
        </div>
      )}
      {children ? (
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-base text-ink">{text}</p>
          {children}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-base text-ink">{text}</p>
      )}
      {note && <p className="text-xs text-ink-dim">{note}</p>}
    </li>
  )
}
