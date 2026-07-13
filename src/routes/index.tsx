import { createFileRoute } from '@tanstack/react-router'
import InputPanel from '../components/InputPanel'
import ModeToggle from '../components/ModeToggle'
import OutputPanel from '../components/OutputPanel'
import UiLangToggle from '../components/UiLangToggle'
import {
  TranslatorProvider,
  useTranslatorContext,
} from '../context/TranslatorContext'
import { useKbd } from '../hooks/useKbd'
import { useTranslatorShortcuts } from '../hooks/useTranslatorShortcuts'
import { useUiLang } from '../hooks/useUiLang'
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
        <span className="hidden h-2 w-2 rounded-full bg-accent sm:inline-block" />
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="h-4 w-4 text-accent sm:hidden"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18" />
        </svg>
        <h1 className="hidden text-sm font-semibold tracking-tight text-ink sm:block">
          Translater
        </h1>
        <UiLangToggle />
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
        <ModeToggle value={mode} onChange={setMode} />
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-border px-3 py-1.5 text-[11px] text-white/80 sm:px-4">
      <ShortcutHints />
    </footer>
  )
}

function TranslatorShortcuts() {
  const { input, live, run, clearInput, textareaRef } = useTranslatorContext()
  useTranslatorShortcuts({
    hasInput: Boolean(input),
    live,
    onForce: () => void run(undefined, 'force'),
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
  const { t } = useUiLang()
  const { mod, shift, sep } = useKbd()
  const Mod = () => <span className="kbd-sym">{mod}</span>
  const Shift = () => <span className="kbd-sym">{shift}</span>
  const Enter = () => <span className="kbd-sym">↵</span>
  return (
    <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-x-4">
      <span>
        <kbd className="kbd">
          <Mod />
          {sep}
          <Enter />
        </kbd>{' '}
        {t('kbdForce')}
      </span>
      <span>
        <kbd className="kbd">
          <Mod />
          {sep}K
        </kbd>{' '}
        {t('kbdFocus')}
      </span>
      <span>
        <kbd className="kbd">
          <Mod />
          {sep}
          <Shift />
          {sep}C
        </kbd>{' '}
        {t('kbdCopy')}
      </span>
      <span>
        <kbd className="kbd">Esc</kbd> {t('kbdClear')}
      </span>
    </div>
  )
}
