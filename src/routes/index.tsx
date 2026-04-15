import { createFileRoute } from '@tanstack/react-router'
import DebugBar from '../components/DebugBar'
import InputPanel from '../components/InputPanel'
import ModeToggle from '../components/ModeToggle'
import OutputPanel from '../components/OutputPanel'
import {
  TranslatorProvider,
  useTranslatorContext,
} from '../context/TranslatorContext'
import { useTranslatorShortcuts } from '../hooks/useTranslatorShortcuts'
import { mainText } from '../lib/liveResult'

export const Route = createFileRoute('/')({ component: Translator })

function Translator() {
  return (
    <TranslatorProvider>
      <TranslatorShortcuts />
      <main className="flex min-h-[100dvh] flex-col md:h-[100dvh]">
        <Header />
        <div className="relative flex flex-1 flex-col md:grid md:grid-cols-2 md:overflow-hidden">
          <InputPanel />
          <OutputPanel />
        </div>
        <Footer />
      </main>
    </TranslatorProvider>
  )
}

function Header() {
  const { mode, setMode } = useTranslatorContext()
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-bg/90 px-3 py-2 backdrop-blur-sm sm:gap-3 sm:px-4 sm:py-3">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-accent" />
        <h1 className="text-sm font-semibold tracking-tight text-ink">
          Translater
        </h1>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
        <ModeToggle value={mode} onChange={setMode} />
      </div>
    </header>
  )
}

function Footer() {
  const { live, lastMeta, sessionCostUsd, sessionCount } =
    useTranslatorContext()
  const meta = live?.meta ?? lastMeta
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-1.5 text-[11px] text-white/80 sm:px-4">
      <ShortcutHints />
      <div className="ml-auto">
        <DebugBar
          meta={meta}
          cached={meta?.durationMs === 0}
          sessionCostUsd={sessionCostUsd}
          sessionCount={sessionCount}
        />
      </div>
    </footer>
  )
}

function TranslatorShortcuts() {
  const { input, live, run, clearInput, textareaRef } = useTranslatorContext()
  useTranslatorShortcuts({
    hasInput: Boolean(input),
    live,
    onForce: () => void run(),
    onCopy: () => {
      const text = mainText(live)
      if (text) void navigator.clipboard.writeText(text)
    },
    onFocusInput: () => {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    },
    onClear: clearInput,
  })
  return null
}

function ShortcutHints() {
  return (
    <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-x-4">
      <span>
        <kbd className="kbd">↵</kbd> translate
      </span>
      <span>
        <kbd className="kbd">⌘↵</kbd> force
      </span>
      <span>
        <kbd className="kbd">⌘K</kbd> focus input
      </span>
      <span>
        <kbd className="kbd">⌘⇧C</kbd> copy result
      </span>
      <span>
        <kbd className="kbd">Esc</kbd> clear
      </span>
    </div>
  )
}
