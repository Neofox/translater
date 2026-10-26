import type { ReactNode } from 'react'
import CopyButton from './CopyButton'
import ListenButton from './ListenButton'
import type { SpeechOptions } from '../hooks/useSpeech'

type Props = {
  text?: string
  note?: string
  copyDisabled?: boolean
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
  copyDisabled,
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
          <CopyButton text={text} disabled={copyDisabled} />
        </div>
      )}
      {children ? (
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="alternative-text min-w-0 break-words text-ink">
            {text}
          </p>
          {children}
        </div>
      ) : (
        <p className="alternative-text whitespace-pre-wrap break-words text-ink">
          {text}
        </p>
      )}
      {note && <p className="alternative-note text-ink-soft">{note}</p>}
    </li>
  )
}
