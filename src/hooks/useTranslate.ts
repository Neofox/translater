import { useCallback, useEffect, useRef, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { translate } from '../server/translate'
import { partialParse } from '../lib/partialParse'
import type { Meta, TranslateChunk, TranslateDone } from '../server/translate'
import type { SentenceResult, WordResult } from '../server/schemas'
import type { Intent, Mode } from '../lib/types'
import type { LangCode } from '../lib/languages'
import { useUiLang } from './useUiLang'
import { STRINGS } from '../lib/i18n'
import { MAX_INPUT_CHARS } from '../lib/limits'

export type TranslateError = {
  message: string
  hint?: string
  kind: 'input' | 'server'
}

export type LiveResult =
  | {
      intent: 'sentence'
      partial: Partial<SentenceResult>
      done: boolean
      meta: Meta | null
      /** The trimmed input text this result was produced for — lets stale
       * consumers (heuristics, safety nets) detect that `live` outlived the
       * input it was streamed for and fall back to fresh evidence. */
      text: string
    }
  | {
      intent: 'word'
      partial: Partial<WordResult>
      done: boolean
      meta: Meta | null
      text: string
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

type Options = {
  /** Debounce window for auto-run when args change. 0 disables auto-run. */
  debounceMs?: number
}

export function useTranslate(
  args: TranslateArgs,
  { debounceMs = 400 }: Options = {},
) {
  const translateFn = useServerFn(translate)
  const { lang: uiLang } = useUiLang()

  const [live, setLive] = useState<LiveResult | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<TranslateError | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipDebounceRef = useRef(false)
  const suppressAutoRunRef = useRef(false)

  const run = useCallback(
    async (override?: Partial<TranslateArgs>) => {
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
      abortRef.current?.abort()

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
      abortRef.current = ctrl

      setIsPending(true)
      setError(null)
      setLive({ intent, partial: {}, done: false, meta: null, text: trimmed })

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
          setError({
            kind: 'server',
            message:
              err instanceof Error
                ? err.message
                : STRINGS[uiLang].translationFailed,
          })
        }
      } finally {
        if (abortRef.current === ctrl) setIsPending(false)
      }

      function applyChunk(chunk: TranslateChunk) {
        if (chunk.type === 'delta') {
          rawJson += chunk.raw
          const parsed = partialParse<SentenceResult | WordResult>(rawJson)
          if (!parsed) return
          setLive((prev) => (prev ? { ...prev, partial: parsed } : prev))
        } else {
          commit(chunk.done)
        }
      }

      function commit(done: TranslateDone) {
        setLive({
          intent: done.intent,
          partial: done.data,
          done: true,
          meta: done.meta,
          text: trimmed,
        })
      }
    },
    [translateFn, args, uiLang],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setLive(null)
    setError(null)
  }, [])

  /** Replace the live result from a client-side snapshot (refine undo) without
   * firing a network run. Suppresses the next auto-run cycle — the caller
   * restores `refinements` in the same tick, which would otherwise re-trigger
   * the debounced effect and defeat the instant undo.
   *
   * `keepError` skips clearing the error — used by the rollback-on-error path
   * so the inline error treatment stays visible per the design spec's State
   * rules, while user-initiated undo (the default) still clears it. */
  const restore = useCallback(
    (snapshot: LiveResult, opts?: { keepError?: boolean }) => {
      abortRef.current?.abort()
      suppressAutoRunRef.current = true
      setIsPending(false)
      if (!opts?.keepError) setError(null)
      setLive(snapshot)
    },
    [],
  )

  /** Skip the debounce window for the next auto-run — call right before a
   * programmatic input change (paste, clipboard button) so the translation
   * fires as soon as the new text lands. */
  const queueImmediate = useCallback(() => {
    skipDebounceRef.current = true
  }, [])

  /** Fire a pending debounced translation now (Enter / blur). Returns true
   * when a run was actually pending and got flushed; false when idle. */
  const flush = useCallback(() => {
    if (timerRef.current === null) return false
    clearTimeout(timerRef.current)
    timerRef.current = null
    void run()
    return true
  }, [run])

  // Debounced auto-run on arg change. Clearing text clears live result immediately.
  // Abort any in-flight stream on input change so stale responses stop writing.
  useEffect(() => {
    if (!debounceMs) return
    abortRef.current?.abort()
    setIsPending(false)
    if (!args.text.trim()) {
      skipDebounceRef.current = false
      setLive(null)
      setError(null)
      return
    }
    if (suppressAutoRunRef.current) {
      suppressAutoRunRef.current = false
      return
    }
    const delay = skipDebounceRef.current ? 0 : debounceMs
    skipDebounceRef.current = false
    const id = setTimeout(() => {
      timerRef.current = null
      void run()
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
  ])

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
