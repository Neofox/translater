import { Loader2 } from 'lucide-react'
import CopyButton from './CopyButton'
import LearningTips from './LearningTips'
import LanguageChipBar from './LanguageChipBar'
import RefineRow from './RefineRow'
import SentenceView from './SentenceView'
import WordView from './WordView'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { mainText } from '../lib/liveResult'

export default function OutputPanel() {
  const {
    target,
    setTarget,
    mode,
    isPolish,
    live,
    isPending,
    streaming,
    error,
    outputTips,
  } = useTranslatorContext()
  const { t } = useUiLang()
  const copyText = mainText(live)

  return (
    <section className="flex min-h-0 flex-col xl:p-6 2xl:p-12">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-ink-soft">
        <LanguageChipBar
          kind="target"
          value={target}
          onChange={setTarget}
          aria-label={t('targetLanguage')}
        />
        <div className="flex items-center gap-2">
          {streaming && (
            <span className="inline-flex items-center gap-1.5 text-xs text-accent">
              <Loader2 size={12} className="animate-spin" />
              {isPolish ? t('polishing') : t('streaming')}
            </span>
          )}
          <LearningTips tips={outputTips} />
          {copyText && <CopyButton text={copyText} compact size="md" />}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {error && <ErrorView error={error} />}
        {!error && live?.intent === 'sentence' && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              <SentenceView result={live.partial} streaming={streaming} />
            </div>
            <RefineRow />
          </div>
        )}
        {!error && live?.intent === 'word' && (
          <WordView result={live.partial} mode={mode} streaming={streaming} />
        )}
        {!error && !live && !isPending && <EmptyState />}
      </div>
    </section>
  )
}

function ErrorView({
  error,
}: {
  error: { message: string; hint?: string; kind: 'input' | 'server' }
}) {
  const { t } = useUiLang()
  const hint =
    error.hint ?? (error.kind === 'server' ? t('errorEnvHint') : null)
  return (
    <div className="p-6 text-sm text-red-400">
      {error.message}
      {hint && <p className="mt-2 text-ink-dim">{hint}</p>}
    </div>
  )
}

function EmptyState() {
  const { t } = useUiLang()
  return (
    <div className="flex h-full min-h-[8rem] flex-col items-center justify-center p-6 text-center text-ink-dim">
      <p className="text-sm">{t('emptyMain')}</p>
      <p className="mt-1 text-xs">{t('emptySub')}</p>
    </div>
  )
}
