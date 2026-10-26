import { useId } from 'react'
import { Loader2, Square, Volume2 } from 'lucide-react'
import Pill from './ui/Pill'
import { useSpeech } from '../hooks/useSpeech'
import type { SpeechOptions } from '../hooks/useSpeech'
import { useUiLang } from '../hooks/useUiLang'

type Props = SpeechOptions & { size?: 'sm' | 'md'; label?: boolean }

export default function ListenButton({
  size = 'md',
  label: showLabel = false,
  ...props
}: Props) {
  const { t } = useUiLang()
  const { status, error, toggle } = useSpeech(props)
  const errorId = useId()
  const active = status !== 'idle'
  const label =
    status === 'loading'
      ? t('speechLoading')
      : active
        ? t('stopListening')
        : t('listen')

  return (
    <span className="relative inline-flex shrink-0">
      <Pill
        tone={active ? 'active' : 'neutral'}
        size={size}
        onClick={toggle}
        disabled={props.disabled || !props.text.trim()}
        aria-label={label}
        title={label}
        aria-pressed={active}
        aria-busy={status === 'loading'}
        aria-describedby={error ? errorId : undefined}
        data-testid="listen-button"
        className={`listen-button ${!showLabel ? 'icon-action' : ''} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {status === 'loading' ? (
          <Loader2
            size={14}
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : active ? (
          <Square size={14} aria-hidden="true" />
        ) : (
          <Volume2 size={14} aria-hidden="true" />
        )}
        {showLabel && <span>{label}</span>}
      </Pill>
      {error && (
        <span
          id={errorId}
          role="status"
          title={t(error)}
          className="absolute right-0 top-full z-20 mt-1 max-w-[calc(100vw-2rem)] truncate whitespace-nowrap rounded-md border border-border bg-panel px-2 py-1 text-xs text-ink shadow-sm"
        >
          {t(error)}
        </span>
      )}
    </span>
  )
}
