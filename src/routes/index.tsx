import { createFileRoute } from '@tanstack/react-router'
import TranslatorWorkspace from '../components/TranslatorWorkspace'
import {
  TranslatorProvider,
  useTranslatorContext,
} from '../context/TranslatorContext'
import { useTranslatorShortcuts } from '../hooks/useTranslatorShortcuts'
import { copyableMainText } from '../lib/liveResult'
import { useUiLang } from '../hooks/useUiLang'

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
  const {
    input,
    source,
    target,
    mode,
    context,
    refinements,
    live,
    isPending,
    error,
    run,
    clearInput,
    textareaRef,
  } = useTranslatorContext()
  const { lang } = useUiLang()
  useTranslatorShortcuts({
    hasInput: Boolean(input),
    live,
    onForce: () => void run(undefined, 'force'),
    onCopy: () => {
      const text = copyableMainText(
        live,
        {
          text: input,
          source,
          target,
          mode,
          context,
          refinements,
          uiLang: lang,
        },
        isPending,
      )
      if (text && !error) void navigator.clipboard.writeText(text)
    },
    onFocusInput: () => {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    },
    onClear: clearInput,
  })
  return null
}
