import { MessageSquareQuote, X } from 'lucide-react'
import Pill from './ui/Pill'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { MAX_CONTEXT_CHARS } from '../lib/limits'

export function ContextToggle({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  const { context } = useTranslatorContext()
  const { t } = useUiLang()
  const active = context.trim().length > 0
  return (
    <Pill
      size="md"
      tone={active ? 'active' : 'neutral'}
      onClick={onToggle}
      aria-expanded={open}
      aria-label={t('contextToggle')}
      title={t('contextToggle')}
      data-testid="context-toggle"
      className="context-toggle"
    >
      <MessageSquareQuote size={14} />
      <span className="context-toggle-label">{t('contextToggle')}</span>
    </Pill>
  )
}

export function ContextTextarea() {
  const { context, setContext } = useTranslatorContext()
  const { t } = useUiLang()
  return (
    <div className="context-field">
      <textarea
        value={context}
        maxLength={MAX_CONTEXT_CHARS}
        onChange={(e) => setContext(e.target.value)}
        placeholder={t('contextPlaceholder')}
        aria-label={t('contextToggle')}
        data-testid="context-textarea"
        className="field-sizing-content max-h-24 min-h-12 w-full resize-none bg-transparent px-4 py-2 pr-12 text-sm leading-relaxed text-ink placeholder:text-ink-dim focus:outline-none scrollbar-thin"
      />
      {context && (
        <button
          type="button"
          onClick={() => setContext('')}
          aria-label={t('contextClear')}
          data-testid="context-clear"
          className="absolute right-1 top-1 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded text-ink transition hover:text-accent"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
