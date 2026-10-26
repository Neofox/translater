import { createFileRoute } from '@tanstack/react-router'
import TranslatorWorkspace from '../components/TranslatorWorkspace'
import {
  TranslatorProvider,
  useTranslatorContext,
} from '../context/TranslatorContext'
import { useTranslatorShortcuts } from '../hooks/useTranslatorShortcuts'
import { mainText, resultIsCurrent } from '../lib/liveResult'
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
      const text = mainText(live)
      if (
        text &&
        live?.done &&
        !isPending &&
        !error &&
        resultIsCurrent(live, {
          text: input,
          source,
          target,
          mode,
          context,
          refinements,
          uiLang: lang,
        })
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
