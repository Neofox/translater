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
import type { LiveResult, TranslateError } from '../hooks/useTranslate'
import { useTranslationPrefs } from '../hooks/useTranslationPrefs'
import { detectIntent } from '../lib/detectIntent'
import { detectLanguage } from '../lib/detectLanguage'
import type { LangCode } from '../lib/languages'
import { MAX_REFINEMENTS, MAX_REFINEMENT_CHARS } from '../lib/limits'
import {
  fallbackTargetFor,
  resolveTranslationTarget,
} from '../lib/resolveTranslationTarget'
import { useSessionState } from '../lib/usePersistentState'
import type { Intent, Mode } from '../lib/types'
import type { LearningTips as LearningTipsType } from '../server/schemas'
import type { Meta } from '../server/translate'

type TranslateHandle = ReturnType<typeof useTranslate>

type RefineSnapshot = {
  live: LiveResult
  refinements: string[]
  previousMain: string
}

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
  /** Fire a pending debounced translation now (Enter / blur). Returns true when one was pending. */
  flush: TranslateHandle['flush']
  /** Skip the debounce for the next auto-run — call before programmatic input changes (paste). */
  queueImmediate: TranslateHandle['queueImmediate']
  inputTips?: Partial<LearningTipsType>
  outputTips?: Partial<LearningTipsType>
  lastMeta: Meta | null
  textareaRef: RefObject<HTMLTextAreaElement | null>
  clearInput: () => void
  lookupWord: (text: string) => void
  context: string
  setContext: (next: string) => void
  refinements: string[]
  addRefinement: (instruction: string) => void
  removeRefinement: (index: number) => void
  undoRefine: () => void
  canUndo: boolean
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

  const MAX_UNDO = 10

  const [context, setContext] = useSessionState('nt.context', '')
  const [refinements, setRefinements] = useState<string[]>([])
  const [previousMain, setPreviousMain] = useState('')
  const [undoStack, setUndoStack] = useState<RefineSnapshot[]>([])
  // True between a refine action firing and its run settling — gates the
  // rollback-on-error effect so unrelated failures don't pop the stack.
  const refineInFlightRef = useRef(false)
  // Mirrors `refinements` synchronously so rapid-fire add/remove calls made
  // within the same React batch (no re-render between them) see an
  // up-to-date length/contents instead of the stale render-time closure —
  // otherwise the cap/dedupe checks below would all read the same pre-batch
  // value and the cap would never trip.
  const refinementsRef = useRef<string[]>(refinements)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const intent = detectIntent(input)
  const trimmedInput = input.trim()

  // Polish mode activates only when the user explicitly sets source === target.
  const rawDetected = source === 'auto' ? detectLanguage(input) : null
  const isPolish = source !== 'auto' && source === target

  // Safety net: the model says the source language IS the current target
  // (something the client heuristic missed). Flip the target once and let the
  // debounced effect re-run. Guarded per input text — max one extra call.
  //
  // Declared above `translationTarget` on purpose: once the safety net has
  // flipped for this exact input, the heuristic detector must stop feeding
  // the resolver, or a stale `rawDetected` (e.g. the low-confidence English
  // fallback) can immediately flip the freshly-corrected target a second
  // time — see the merci-beaucoup/fr/en/ko cascade this guards against.
  const flipGuardRef = useRef<string | null>(null)
  const translationTarget = resolveTranslationTarget({
    source,
    target,
    detected: flipGuardRef.current === trimmedInput ? null : rawDetected,
  })

  // Auto-swap target when source=auto and the detected input language matches the
  // current target, so we always translate instead of polishing or idling.
  useEffect(() => {
    if (!input.trim()) return
    if (source !== 'auto') return
    if (!rawDetected) return
    if (translationTarget !== target) setTarget(translationTarget)
  }, [source, rawDetected, target, translationTarget, input, setTarget])

  const {
    live,
    isPending,
    streaming,
    error,
    run,
    reset,
    flush,
    queueImmediate,
    restore,
  } = useTranslate({
    text: input,
    source,
    target: translationTarget,
    mode,
    intent,
    context,
    refinements,
    previousMain,
  })

  // Only trust the model's reported source language while `live` still
  // corresponds to the current input — `live` deliberately outlives input
  // changes (to keep the old translation visible while typing), so a stale
  // `live.partial.sourceLang` must not leak into the heuristic here.
  const liveMatchesInput = live?.text === input.trim()
  const reportedSource = liveMatchesInput ? live.partial.sourceLang : undefined
  const modelDetected = VALID_DETECTED.includes(reportedSource as LangCode)
    ? (reportedSource as LangCode)
    : null
  const detected = source === 'auto' ? (modelDetected ?? rawDetected) : null

  useEffect(() => {
    if (!live?.done || source !== 'auto') return
    if (live.text !== input.trim()) return
    const reported = live.partial.sourceLang
    if (!reported || reported === 'other') return
    if (reported !== target) return
    if (flipGuardRef.current === trimmedInput) return
    flipGuardRef.current = trimmedInput
    setTarget(fallbackTargetFor(reported))
  }, [live, source, target, input, setTarget])

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

  // Last completed request's meta survives input clears for the debug bar.
  const [lastMeta, setLastMeta] = useState<Meta | null>(null)

  useEffect(() => {
    if (live?.done && live.meta) setLastMeta(live.meta)
  }, [live])

  // Focus input on mount, but not on touch devices (avoids popping the keyboard).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(pointer: fine)').matches) {
      textareaRef.current?.focus()
    }
  }, [])

  // Refinements describe a result produced for a specific source text; once
  // that text changes they are meaningless. Context intentionally survives.
  const setInputWithRefineReset = useCallback(
    (next: string) => {
      if (next.trim() !== input.trim()) {
        refinementsRef.current = []
        setRefinements([])
        setPreviousMain('')
        setUndoStack([])
        refineInFlightRef.current = false
      }
      setInput(next)
    },
    [input, setInput],
  )

  const clearInput = useCallback(() => {
    setInputWithRefineReset('')
    reset()
    textareaRef.current?.focus()
  }, [setInputWithRefineReset, reset])

  const lookupWord = useCallback(
    (text: string) => {
      setInputWithRefineReset(text)
      textareaRef.current?.focus()
    },
    [setInputWithRefineReset],
  )

  const addRefinement = useCallback(
    (instruction: string) => {
      const trimmed = instruction.trim().slice(0, MAX_REFINEMENT_CHARS)
      if (!trimmed) return
      const current = refinementsRef.current
      if (current.length >= MAX_REFINEMENTS) return
      if (current.includes(trimmed)) return
      if (!live || live.intent !== 'sentence' || !live.done) return
      setUndoStack((prev) => [
        ...prev.slice(-(MAX_UNDO - 1)),
        { live, refinements: current, previousMain },
      ])
      setPreviousMain(live.partial.main ?? '')
      refineInFlightRef.current = true
      queueImmediate()
      const next = [...current, trimmed]
      refinementsRef.current = next
      setRefinements(next)
    },
    [live, previousMain, queueImmediate],
  )

  const removeRefinement = useCallback(
    (index: number) => {
      const current = refinementsRef.current
      if (!live || live.intent !== 'sentence' || !live.done) return
      if (index < 0 || index >= current.length) return
      setUndoStack((prev) => [
        ...prev.slice(-(MAX_UNDO - 1)),
        { live, refinements: current, previousMain },
      ])
      setPreviousMain(live.partial.main ?? '')
      refineInFlightRef.current = true
      queueImmediate()
      const next = current.filter((_, i) => i !== index)
      refinementsRef.current = next
      setRefinements(next)
    },
    [live, previousMain, queueImmediate],
  )

  const undoRefine = useCallback(() => {
    const snap = undoStack[undoStack.length - 1]
    if (!snap) return
    refineInFlightRef.current = false
    restore(snap.live)
    refinementsRef.current = snap.refinements
    setRefinements(snap.refinements)
    setPreviousMain(snap.previousMain)
    setUndoStack((prev) => prev.slice(0, -1))
  }, [undoStack, restore])

  useEffect(() => {
    if (live?.done) refineInFlightRef.current = false
  }, [live])

  useEffect(() => {
    if (!error || error.kind !== 'server') return
    if (!refineInFlightRef.current) return
    refineInFlightRef.current = false
    undoRefine()
  }, [error, undoRefine])

  const value: TranslatorContextValue = {
    input,
    setInput: setInputWithRefineReset,
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
    flush,
    queueImmediate,
    inputTips,
    outputTips,
    lastMeta,
    textareaRef,
    clearInput,
    lookupWord,
    context,
    setContext,
    refinements,
    addRefinement,
    removeRefinement,
    undoRefine,
    canUndo: undoStack.length > 0,
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
