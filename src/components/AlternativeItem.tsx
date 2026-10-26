import type { ReactNode } from 'react'
import CopyButton from './CopyButton'
import ListenButton from './ListenButton'
import type { SpeechOptions } from '../hooks/useSpeech'

type Props = {
  text?: string
  note?: string
  index: number
  children?: ReactNode
  speech?: Omit<SpeechOptions, 'text'>
}

export default function AlternativeItem({
  text,
  note,
  index,
  children,
  speech,
}: Props) {
  return (
    <li
      data-testid="alternative-item"
      className="alternative-item animate-settle group flow-root rounded-lg border border-border bg-panel px-3 py-2"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {text && (
        <div className="alternative-actions float-right ml-2 inline-flex items-center gap-1.5">
          {speech && <ListenButton {...speech} text={text} size="sm" />}
          <CopyButton text={text} compact />
        </div>
      )}
      {children ? (
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="min-w-0 break-words text-base text-ink">{text}</p>
          {children}
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-base text-ink">
          {text}
        </p>
      )}
      {note && <p className="text-xs text-ink-dim">{note}</p>}
    </li>
  )
}
