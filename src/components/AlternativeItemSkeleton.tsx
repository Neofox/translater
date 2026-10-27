import CopyButton from './CopyButton'
import ListenButton from './ListenButton'
import type { SpeechOptions } from '../hooks/useSpeech'

export default function AlternativeItemSkeleton({
  speech,
}: {
  speech?: Omit<SpeechOptions, 'text'>
}) {
  return (
    <li className="alternative-item alternative-skeleton" aria-hidden>
      <div className="alternative-actions inline-flex items-center">
        <CopyButton text="" disabled compact />
        <ListenButton
          text=""
          language={speech?.language ?? 'en'}
          disabled
          size="sm"
        />
      </div>
      <p className="alternative-text">
        <span className="animate-pulse" />
      </p>
      <p className="alternative-note">
        <span className="animate-pulse" />
      </p>
    </li>
  )
}
