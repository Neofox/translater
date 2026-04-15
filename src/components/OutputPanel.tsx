import { Loader2 } from 'lucide-react'
import CopyButton from './CopyButton'
import LearningTips from './LearningTips'
import LanguageSelect from './LanguageSelect'
import SentenceView from './SentenceView'
import WordView from './WordView'
import { useTranslatorContext } from '../context/TranslatorContext'
import { mainText } from '../lib/liveResult'

export default function OutputPanel() {
  const {
    target,
    setTarget,
    mode,
    live,
    isPending,
    streaming,
    error,
    outputTips,
  } = useTranslatorContext()
  const copyText = mainText(live)

  return (
    <section className="flex min-h-0 flex-col xl:p-6 2xl:p-12">
      <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-ink-soft">
        <div className="flex flex-wrap items-center gap-2">
          <LanguageSelect
            value={target}
            onChange={setTarget}
            aria-label="Target language"
          />
          {copyText && <CopyButton text={copyText} />}
          <LearningTips tips={outputTips} />
        </div>
        {streaming && (
          <span className="inline-flex items-center gap-1.5 text-xs text-accent">
            <Loader2 size={12} className="animate-spin" />
            Streaming…
          </span>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {error && <ErrorView message={error} />}
        {!error && live?.intent === 'sentence' && (
          <SentenceView result={live.partial} streaming={streaming} />
        )}
        {!error && live?.intent === 'word' && (
          <WordView result={live.partial} mode={mode} streaming={streaming} />
        )}
        {!error && !live && !isPending && <EmptyState />}
      </div>
    </section>
  )
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="p-6 text-sm text-red-400">
      {message}
      <p className="mt-2 text-ink-dim">
        Check <code className="font-mono text-xs">.env</code> — either{' '}
        <code className="font-mono text-xs">OPENAI_API_KEY</code> for cloud or a
        loaded LM Studio model for local.
      </p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-[8rem] flex-col items-center justify-center p-6 text-center text-ink-dim">
      <p className="text-sm">Paste or type something to translate.</p>
      <p className="mt-1 text-xs">
        Short input → dictionary view. Full sentences → translation with
        alternatives.
      </p>
    </div>
  )
}
