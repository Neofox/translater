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

export type LiveResult =
  | {
      intent: 'sentence'
      partial: Partial<SentenceResult>
      done: boolean
      meta: Meta | null
    }
  | {
      intent: 'word'
      partial: Partial<WordResult>
      done: boolean
      meta: Meta | null
    }

export type TranslateArgs = {
  text: string
  source: LangCode
  target: LangCode
  mode: Mode
  intent: Intent
}

type Options = {
  /** Debounce window for auto-run when args change. 0 disables auto-run. */
  debounceMs?: number
}

export function useTranslate(
  args: TranslateArgs,
  { debounceMs = 800 }: Options = {},
) {
  const translateFn = useServerFn(translate)
  const { lang: uiLang } = useUiLang()

  const [live, setLive] = useState<LiveResult | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(
    async (override?: Partial<TranslateArgs>) => {
      const { text, source, target, mode, intent } = { ...args, ...override }
      const trimmed = text.trim()
      if (!trimmed) return
      if (source === target && source !== 'auto') {
        setError(STRINGS[uiLang].sameLanguageError)
        return
      }
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl

      setIsPending(true)
      setError(null)
      setLive({ intent, partial: {}, done: false, meta: null })

      try {
        const stream = await translateFn({
          data: { text: trimmed, source, target, mode, intent, uiLang },
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
          setError(
            err instanceof Error
              ? err.message
              : STRINGS[uiLang].translationFailed,
          )
        }
      } finally {
        if (abortRef.current === ctrl) setIsPending(false)
      }

      function applyChunk(chunk: TranslateChunk) {
        if (chunk.type === 'delta') {
          const parsed = partialParse<SentenceResult | WordResult>(chunk.raw)
          if (!parsed) return
          setLive((prev) =>
            prev ? ({ ...prev, partial: parsed } as LiveResult) : prev,
          )
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
        } as LiveResult)
      }
    },
    [translateFn, args, uiLang],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setLive(null)
    setError(null)
  }, [])

  // Debounced auto-run on arg change. Clearing text clears live result immediately.
  // Abort any in-flight stream on input change so stale responses stop writing.
  useEffect(() => {
    if (!debounceMs) return
    abortRef.current?.abort()
    setIsPending(false)
    if (!args.text.trim()) {
      setLive(null)
      return
    }
    const id = setTimeout(() => void run(), debounceMs)
    return () => clearTimeout(id)
    // `run` intentionally omitted: it re-identities on every args change,
    // which would double-fire. Only re-debounce on actual input changes.
  }, [
    args.text,
    args.source,
    args.target,
    args.mode,
    args.intent,
    uiLang,
    debounceMs,
  ])

  const streaming = isPending && !live?.done

  return { live, isPending, streaming, error, run, reset }
}
