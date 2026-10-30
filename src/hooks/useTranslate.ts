import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useServerFn } from '@tanstack/react-start'
import { translate, warmTranslation } from '../server/translate'
import { partialParse } from '../lib/partialParse'
import type { TranslateChunk, TranslateDone } from '../server/translate'
import type { SentenceResult, WordResult } from '../server/schemas'
import type { Intent, Mode } from '../lib/types'
import type { LangCode } from '../lib/languages'
import { useUiLang } from './useUiLang'
import { STRINGS } from '../lib/i18n'
import { MAX_INPUT_CHARS } from '../lib/limits'
import { translationRequestKey } from '../lib/translationRequestKey'

export type TranslateError = {
  message: string
  hint?: string
  kind: 'input' | 'server'
}

export type LiveResult =
  | {
      requestKey?: string
      intent: 'sentence'
      partial: Partial<SentenceResult>
      done: boolean
      /** The main JSON string has closed, even if learner details still stream. */
      mainReady?: boolean
      requestSource: LangCode
      /** The trimmed input text this result was produced for — lets stale
       * consumers (heuristics, safety nets) detect that `live` outlived the
       * input it was streamed for and fall back to fresh evidence. */
      text: string
    }
  | {
      requestKey?: string
      intent: 'word'
      partial: Partial<WordResult>
      done: boolean
      mainReady?: boolean
      requestSource: LangCode
      text: string
    }

export type SourceDetectedReport = {
  text: string
  requestSource: LangCode
  sourceLang: SentenceResult['sourceLang'] | WordResult['sourceLang']
}

export type TranslateArgs = {
  text: string
  source: LangCode
  target: LangCode
  mode: Mode
  intent: Intent
  context: string
  refinements: string[]
  previousMain: string
}

export type TranslationTrigger =
  'debounce' | 'paste' | 'enter' | 'blur' | 'force' | 'refinement'

type ImmediateTrigger = Extract<TranslationTrigger, 'paste' | 'refinement'>
type FlushTrigger = Extract<TranslationTrigger, 'enter' | 'blur'>

type ActiveRun = {
  controller: AbortController
  id?: string
}

type Options = {
  /** Debounce window for auto-run when args change. 0 disables auto-run. */
  debounceMs?: number
  onSourceDetected?: (report: SourceDetectedReport) => void
}

export const DEFAULT_TRANSLATE_DEBOUNCE_MS = 800
export const FINISHED_TEXT_DEBOUNCE_MS = 400
// At most one free warm-up per interval keeps a function instance ready.
export const WARM_INTERVAL_MS = 2 * 60_000

// Text ending in sentence-final punctuation (or an emoji) is probably done, so
// it translates sooner. Anything else, including punctuation followed by a
// space or newline, may be a pause mid-sentence and keeps the full debounce.
// Never match letters: Korean IMEs pass through partial jamo on every key.
const FINISHED_TEXT =
  /(?:[.!?…。！？~～]|\p{Extended_Pictographic}[\p{Emoji_Modifier}️]*)['"’”)\]」』]*$/u

export function debounceFor(text: string, debounceMs: number): number {
  return FINISHED_TEXT.test(text)
    ? Math.min(debounceMs, FINISHED_TEXT_DEBOUNCE_MS)
    : debounceMs
}

let lastWarmAt = Number.NEGATIVE_INFINITY

// Some models wrap the main translation in newlines, which the pre-wrap main
// text would show as blank lines. Trim once here so display, Copy and learning
// offsets share one string; keep trailing spaces while main is still streaming.
function trimMain<T extends { main?: unknown; primaryTranslation?: unknown }>(
  data: T,
  closed: boolean,
): T {
  const trim = (text: string) => (closed ? text.trim() : text.trimStart())
  return {
    ...data,
    ...(typeof data.main === 'string' && { main: trim(data.main) }),
    ...(typeof data.primaryTranslation === 'string' && {
      primaryTranslation: trim(data.primaryTranslation),
    }),
  }
}

export function useTranslate(
  args: TranslateArgs,
  {
    debounceMs = DEFAULT_TRANSLATE_DEBOUNCE_MS,
    onSourceDetected,
  }: Options = {},
) {
  const translateFn = useServerFn(translate)
  const warmFn = useServerFn(warmTranslation)
  const { lang: uiLang } = useUiLang()

  const [live, setLive] = useState<LiveResult | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<TranslateError | null>(null)
  const activeRunRef = useRef<ActiveRun | null>(null)
  const supersededRunIdRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipDebounceRef = useRef(false)
  const immediateTriggerRef = useRef<ImmediateTrigger | null>(null)
  const suppressAutoRunRef = useRef(false)
  const analyticsSessionIdRef = useRef<string | null>(null)
  const inputRevisionRef = useRef(args.text.trim() ? 1 : 0)
  const previousInputRef = useRef(args.text)

  // Group translations from one open page without creating a durable user
  // identifier. This stays in memory only and resets on every page load.
  if (
    analyticsSessionIdRef.current === null &&
    typeof window !== 'undefined' &&
    typeof window.crypto.randomUUID === 'function'
  ) {
    analyticsSessionIdRef.current = window.crypto.randomUUID()
  }

  const analyticsId = useCallback(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.crypto.randomUUID !== 'function'
    ) {
      return undefined
    }
    return window.crypto.randomUUID()
  }, [])

  const abortActiveRun = useCallback((preserveForNextRun: boolean) => {
    const active = activeRunRef.current
    if (!preserveForNextRun) supersededRunIdRef.current = null
    if (!active || active.controller.signal.aborted) return
    if (preserveForNextRun && active.id) {
      supersededRunIdRef.current = active.id
    }
    active.controller.abort()
  }, [])

  const finishActiveRun = useCallback((controller: AbortController) => {
    if (activeRunRef.current?.controller !== controller) return
    activeRunRef.current = null
    setIsPending(false)
  }, [])

  useEffect(() => {
    if (previousInputRef.current === args.text) return
    previousInputRef.current = args.text
    inputRevisionRef.current += 1
  }, [args.text])

  const run = useCallback(
    async (
      override?: Partial<TranslateArgs>,
      trigger: TranslationTrigger = 'force',
    ) => {
      const {
        text,
        source,
        target,
        mode,
        intent,
        context,
        refinements,
        previousMain,
      } = { ...args, ...override }
      const trimmed = text.trim()
      if (!trimmed) return
      abortActiveRun(true)

      if (trimmed.length > MAX_INPUT_CHARS) {
        const s = STRINGS[uiLang]
        setIsPending(false)
        setLive(null)
        setError({
          kind: 'input',
          message: s.inputTooLong,
          hint: s.inputTooLongHint
            .replace('{max}', String(MAX_INPUT_CHARS))
            .replace('{count}', String(trimmed.length)),
        })
        return
      }

      const ctrl = new AbortController()
      const runId = analyticsId()
      const supersedesRunId = supersededRunIdRef.current ?? undefined
      supersededRunIdRef.current = null
      activeRunRef.current = { controller: ctrl, id: runId }

      const requestKey = translationRequestKey({
        text: trimmed,
        source,
        target,
        mode,
        context,
        refinements,
        uiLang,
      })
      setIsPending(true)
      setError(null)
      setLive({
        intent,
        partial: {},
        done: false,
        requestSource: source,
        requestKey,
        text: trimmed,
      })

      // Server streams incremental JSON fragments; accumulate them here.
      let rawJson = ''

      try {
        const stream = await translateFn({
          data: {
            text: trimmed,
            source,
            target,
            mode,
            intent,
            uiLang,
            context,
            refinements,
            previousMain,
            analyticsSessionId: analyticsSessionIdRef.current ?? undefined,
            analyticsRunId: runId,
            analyticsSupersedesRunId: supersedesRunId,
            analyticsInputRevision: inputRevisionRef.current,
            analyticsTrigger: trigger,
          },
          signal: ctrl.signal,
        })

        const reader = stream.getReader()
        let next = await reader.read()
        while (!next.done) {
          if (ctrl.signal.aborted) {
            void reader.cancel()
            break
          }
          applyChunk(next.value)
          next = await reader.read()
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          startTransition(() => {
            setError({
              kind: 'server',
              message:
                err instanceof Error
                  ? err.message
                  : STRINGS[uiLang].translationFailed,
            })
          })
        }
      } finally {
        finishActiveRun(ctrl)
      }

      function applyChunk(chunk: TranslateChunk) {
        if (chunk.type === 'delta') {
          rawJson += chunk.raw
          const parsed = partialParse<SentenceResult | WordResult>(rawJson)
          if (!parsed) return
          // Exclude unterminated strings for readiness, while retaining them
          // in the visible partial result so translation text still streams.
          const closed = partialParse<SentenceResult & WordResult>(
            rawJson,
            false,
          )
          const completeMain =
            intent === 'sentence' ? closed?.main : closed?.primaryTranslation
          const mainReady =
            typeof completeMain === 'string' && Boolean(completeMain.trim())
          if (parsed.sourceLang) {
            onSourceDetected?.({
              text: trimmed,
              requestSource: source,
              sourceLang: parsed.sourceLang,
            })
          }
          const partial = trimMain(parsed, mainReady)
          setLive((prev) => (prev ? { ...prev, partial, mainReady } : prev))
        } else {
          commit(chunk.done)
        }
      }

      function commit(done: TranslateDone) {
        onSourceDetected?.({
          text: trimmed,
          requestSource: source,
          sourceLang: done.data.sourceLang,
        })
        // Only settled results participate in view transitions. New-run state
        // and text deltas stay urgent so a fast stream never merges with the
        // previous result's intent, source, or text while React defers work.
        startTransition(() => {
          setLive({
            intent: done.intent,
            partial: trimMain(done.data, true),
            done: true,
            requestSource: source,
            requestKey,
            text: trimmed,
          })
        })
      }
    },
    [
      translateFn,
      args,
      uiLang,
      abortActiveRun,
      analyticsId,
      finishActiveRun,
      onSourceDetected,
    ],
  )

  const reset = useCallback(() => {
    abortActiveRun(false)
    activeRunRef.current = null
    setLive(null)
    setError(null)
  }, [abortActiveRun])

  /** Replace the live result from a client-side snapshot (refine undo/
   * rollback) without firing a network run. Suppresses the next auto-run
   * cycle — the caller restores `refinements` in the same tick, which would
   * otherwise re-trigger the debounced effect and defeat the instant undo.
   * Always clears `error` so the result renders again; a rolled-back refine's
   * failure notice is tracked separately by the caller (`refineError` on
   * TranslatorContext), not kept here. */
  const restore = useCallback(
    (snapshot: LiveResult) => {
      abortActiveRun(false)
      activeRunRef.current = null
      suppressAutoRunRef.current = true
      setIsPending(false)
      setError(null)
      setLive(snapshot)
    },
    [abortActiveRun],
  )

  /** Skip the debounce window for the next auto-run and retain the reason —
   * call right before a paste or refinement changes the request arguments. */
  const queueImmediate = useCallback((trigger: ImmediateTrigger) => {
    skipDebounceRef.current = true
    immediateTriggerRef.current = trigger
  }, [])

  /** Fire a pending debounced translation now (Enter / blur). Returns true
   * when a run was actually pending and got flushed; false when idle. */
  const flush = useCallback(
    (trigger: FlushTrigger) => {
      if (timerRef.current === null) return false
      clearTimeout(timerRef.current)
      timerRef.current = null
      void run(undefined, trigger)
      return true
    },
    [run],
  )

  // Debounced auto-run on arg change. Clearing text clears live result immediately.
  // Abort any in-flight stream on input change so stale responses stop writing.
  useEffect(() => {
    if (!debounceMs) return
    abortActiveRun(true)
    setIsPending(false)
    if (!args.text.trim()) {
      skipDebounceRef.current = false
      immediateTriggerRef.current = null
      supersededRunIdRef.current = null
      setLive(null)
      setError(null)
      return
    }
    if (suppressAutoRunRef.current) {
      suppressAutoRunRef.current = false
      return
    }
    const delay = skipDebounceRef.current
      ? 0
      : debounceFor(args.text, debounceMs)
    const trigger = immediateTriggerRef.current ?? 'debounce'
    skipDebounceRef.current = false
    immediateTriggerRef.current = null
    const id = setTimeout(() => {
      timerRef.current = null
      void run(undefined, trigger)
    }, delay)
    timerRef.current = id
    return () => {
      clearTimeout(id)
      if (timerRef.current === id) timerRef.current = null
    }
    // `run` intentionally omitted: it re-identities on every args change,
    // which would double-fire. Only re-debounce on actual input changes.
    // `args.previousMain` intentionally omitted: it only ever changes
    // together with `args.refinements` (same refine/undo action), so listing
    // it here would double-schedule the debounce for a single user action.
  }, [
    args.text,
    args.source,
    args.target,
    args.mode,
    args.intent,
    args.context,
    args.refinements,
    uiLang,
    debounceMs,
    abortActiveRun,
  ])

  // Focusing the page (usually the editor) or returning to the tab signals an
  // upcoming translation; boot the server function now instead of on submit.
  useEffect(() => {
    const warm = () => {
      if (document.hidden) return
      const now = Date.now()
      if (now - lastWarmAt < WARM_INTERVAL_MS) return
      lastWarmAt = now
      warmFn().catch(() => {})
    }
    document.addEventListener('focusin', warm)
    document.addEventListener('visibilitychange', warm)
    return () => {
      document.removeEventListener('focusin', warm)
      document.removeEventListener('visibilitychange', warm)
    }
  }, [warmFn])

  const streaming = isPending && !live?.done

  return {
    live,
    isPending,
    streaming,
    error,
    run,
    reset,
    flush,
    queueImmediate,
    restore,
  }
}
