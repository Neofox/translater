import { createFileRoute } from '@tanstack/react-router'
import TranslatorWorkspace from '../components/TranslatorWorkspace'
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
      <TranslatorWorkspace />
    </TranslatorProvider>
  )
}

function TranslatorShortcuts() {
  const { input, live, isPending, error, run, clearInput, textareaRef } =
    useTranslatorContext()
  useTranslatorShortcuts({
    hasInput: Boolean(input),
    live,
    onForce: () => void run(undefined, 'force'),
    onCopy: () => {
      const text = mainText(live)
      if (
        text &&
        live?.done &&
        !isPending &&
        !error &&
        live.text === input.trim()
      )
        void navigator.clipboard.writeText(text)
    },
    onFocusInput: () => {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    },
    onClear: clearInput,
  })
  return null
}
