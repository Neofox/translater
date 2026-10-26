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
    >
      <MessageSquareQuote size={14} />
      <span className="hidden @min-[42rem]/input-toolbar:inline">
        {t('contextToggle')}
      </span>
    </Pill>
  )
}

export function ContextTextarea() {
  const { context, setContext } = useTranslatorContext()
  const { t } = useUiLang()
  return (
    <div className="relative border-b border-border bg-panel/40">
      <textarea
        value={context}
        maxLength={MAX_CONTEXT_CHARS}
        onChange={(e) => setContext(e.target.value)}
        placeholder={t('contextPlaceholder')}
        aria-label={t('contextToggle')}
        data-testid="context-textarea"
        className="field-sizing-content max-h-32 min-h-[3rem] w-full resize-none bg-transparent px-4 py-2 text-sm leading-relaxed text-ink-soft placeholder:text-ink-dim focus:outline-none scrollbar-thin sm:px-6 xl:px-12 2xl:px-18"
      />
      {context && (
        <button
          type="button"
          onClick={() => setContext('')}
          aria-label={t('contextClear')}
          data-testid="context-clear"
          className="absolute right-2 top-2 xl:right-8 2xl:right-14 cursor-pointer rounded p-1 text-ink-dim transition hover:text-ink"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
