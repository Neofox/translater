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
import type { TranslateError } from '../hooks/useTranslate'
import { useTranslationPrefs } from '../hooks/useTranslationPrefs'
import { detectIntent } from '../lib/detectIntent'
import { detectLanguage } from '../lib/detectLanguage'
import type { LangCode } from '../lib/languages'
import {
  fallbackTargetFor,
  resolveTranslationTarget,
} from '../lib/resolveTranslationTarget'
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
  detected: LangCode | null
  live: TranslateHandle['live']
  isPending: boolean
  streaming: boolean
  error: TranslateError | null
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

  // Polish mode activates only when the user explicitly sets source === target.
  const rawDetected = source === 'auto' ? detectLanguage(input) : null
  const isPolish = source !== 'auto' && source === target
  const translationTarget = resolveTranslationTarget({
    source,
    target,
    detected: rawDetected,
  })

  // Auto-swap target when source=auto and the detected input language matches the
  // current target, so we always translate instead of polishing or idling.
  useEffect(() => {
    if (!input.trim()) return
    if (source !== 'auto') return
    if (!rawDetected) return
    if (translationTarget !== target) setTarget(translationTarget)
  }, [source, rawDetected, target, translationTarget, input, setTarget])

  const { live, isPending, streaming, error, run, reset } = useTranslate({
    text: input,
    source,
    target: translationTarget,
    mode,
    intent,
  })

  // Streaming partials can carry a truncated sourceLang (partial-json cuts
  // mid-string), so only trust complete known codes. 'other' renders nothing.
  const VALID_DETECTED: ReadonlyArray<LangCode> = [
    'en',
    'ko',
    'ja',
    'fr',
    'es',
    'zh',
  ]
  const reportedSource = live?.partial.sourceLang
  const modelDetected = VALID_DETECTED.includes(reportedSource as LangCode)
    ? (reportedSource as LangCode)
    : null
  const detected = source === 'auto' ? (modelDetected ?? rawDetected) : null

  // Safety net: the model says the source language IS the current target
  // (something the client heuristic missed). Flip the target once and let the
  // debounced effect re-run. Guarded per input text — max one extra call.
  const flipGuardRef = useRef<string | null>(null)
  useEffect(() => {
    if (!live?.done || source !== 'auto' || isPolish) return
    const reported = live.partial.sourceLang
    if (!reported || reported === 'other') return
    if (reported !== target) return
    if (flipGuardRef.current === input) return
    flipGuardRef.current = input
    setTarget(fallbackTargetFor(reported))
  }, [live, source, target, input, isPolish, setTarget])

  // Position the learning-tips pill on whichever side holds the non-English
  // language. If the source is foreign the user is reading — show tips there;
  // otherwise if the target is foreign the user is composing — show on output.
  const learningTips = live?.partial.learningTips
  const detectedSource = source === 'auto' ? (rawDetected ?? 'en') : source
  const sourceIsForeign = detectedSource !== 'en'
  const targetIsForeign = translationTarget !== 'en'
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
    detected,
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
