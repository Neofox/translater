import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode, RefObject } from 'react'
import { useTranslate } from '../hooks/useTranslate'
import { useTranslationPrefs } from '../hooks/useTranslationPrefs'
import { detectIntent } from '../lib/detectIntent'
import { detectLanguage } from '../lib/detectLanguage'
import type { LangCode } from '../lib/languages'
import type { Intent, Mode } from '../lib/types'
import type { LearningTips as LearningTipsType } from '../server/schemas'
import type { Meta } from '../server/translate'

type TranslateHandle = ReturnType<typeof useTranslate>

type TranslatorContextValue = {
  input: string
  setInput: (next: string) => void
  source: LangCode
  setSource: (next: LangCode) => void
  target: LangCode
  setTarget: (next: LangCode) => void
  mode: Mode
  setMode: (next: Mode) => void
  intent: Intent
  isPolish: boolean
  live: TranslateHandle['live']
  isPending: boolean
  streaming: boolean
  error: string | null
  run: TranslateHandle['run']
  reset: TranslateHandle['reset']
  inputTips?: Partial<LearningTipsType>
  outputTips?: Partial<LearningTipsType>
  lastMeta: Meta | null
  sessionCostUsd: number
  sessionCount: number
  textareaRef: RefObject<HTMLTextAreaElement | null>
  clearInput: () => void
  lookupWord: (text: string) => void
}

const TranslatorContext = createContext<TranslatorContextValue | null>(null)

export function TranslatorProvider({ children }: { children: ReactNode }) {
  const {
    input,
    setInput,
    source,
    setSource,
    target,
    setTarget,
    mode,
    setMode,
  } = useTranslationPrefs()

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const intent = detectIntent(input)

  // Resolve source='auto' to the detected language when it matches the target,
  // so polish mode activates (instead of asking the server to translate X→X).
  const rawDetected = source === 'auto' ? detectLanguage(input) : null
  const effectiveSource: LangCode =
    rawDetected && rawDetected === target ? target : source
  const isPolish = effectiveSource === target

  const { live, isPending, streaming, error, run, reset } = useTranslate({
    text: input,
    source: effectiveSource,
    target,
    mode,
    intent,
  })

  // Position the learning-tips pill on whichever side holds the non-English
  // language. If the source is foreign the user is reading — show tips there;
  // otherwise if the target is foreign the user is composing — show on output.
  const learningTips = live?.partial.learningTips
  const detectedSource = source === 'auto' ? (rawDetected ?? 'en') : source
  const sourceIsForeign = detectedSource !== 'en'
  const targetIsForeign = target !== 'en'
  const inputTips = sourceIsForeign ? learningTips : undefined
  const outputTips =
    !sourceIsForeign && targetIsForeign ? learningTips : undefined

  // Session totals: persist across input clears, reset on page refresh.
  const [lastMeta, setLastMeta] = useState<Meta | null>(null)
  const [sessionCostUsd, setSessionCostUsd] = useState(0)
  const [sessionCount, setSessionCount] = useState(0)
  const countedMetaRef = useRef<Meta | null>(null)

  useEffect(() => {
    const meta = live?.meta
    if (!live?.done || !meta) return
    setLastMeta(meta)
    if (countedMetaRef.current === meta) return
    countedMetaRef.current = meta
    // Skip cache hits — no provider call, no new cost incurred this session.
    if (meta.durationMs === 0) return
    setSessionCount((n) => n + 1)
    if (typeof meta.costUsd === 'number') {
      setSessionCostUsd((c) => c + (meta.costUsd ?? 0))
    }
  }, [live])

  // Focus input on mount, but not on touch devices (avoids popping the keyboard).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(pointer: fine)').matches) {
      textareaRef.current?.focus()
    }
  }, [])

  const clearInput = useCallback(() => {
    setInput('')
    reset()
    textareaRef.current?.focus()
  }, [setInput, reset])

  const lookupWord = useCallback(
    (text: string) => {
      setInput(text)
      textareaRef.current?.focus()
    },
    [setInput],
  )

  const value: TranslatorContextValue = {
    input,
    setInput,
    source,
    setSource,
    target,
    setTarget,
    mode,
    setMode,
    intent,
    isPolish,
    live,
    isPending,
    streaming,
    error,
    run,
    reset,
    inputTips,
    outputTips,
    lastMeta,
    sessionCostUsd,
    sessionCount,
    textareaRef,
    clearInput,
    lookupWord,
  }

  return (
    <TranslatorContext.Provider value={value}>
      {children}
    </TranslatorContext.Provider>
  )
}

export function useTranslatorContext(): TranslatorContextValue {
  const ctx = useContext(TranslatorContext)
  if (!ctx) {
    throw new Error(
      'useTranslatorContext must be used inside <TranslatorProvider>',
    )
  }
  return ctx
}
