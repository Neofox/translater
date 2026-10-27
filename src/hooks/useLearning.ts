import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useServerFn } from '@tanstack/react-start'
import { learn } from '../server/learning'
import { LearningInput } from '../server/learningTypes'
import type { LearningInputData, LearningResult } from '../server/learningTypes'
import { sentenceRanges } from '../lib/learningRanges'

type Options = {
  snapshot: LearningInputData | null
  requestKey: string | null
  enabled: boolean
}
type State = {
  identity: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  result: LearningResult | null
  error: string | null
  isOpen: boolean
  minimized: boolean
  sentence: number
  chunk: number | null
}
const empty = (identity: string): State => ({
  identity,
  status: 'idle',
  result: null,
  error: null,
  isOpen: false,
  minimized: false,
  sentence: 0,
  chunk: null,
})

export function useLearning({ snapshot, requestKey, enabled }: Options) {
  const invoke = useServerFn(learn)
  const identity = JSON.stringify([requestKey, snapshot])
  const latest = useRef({ identity, enabled, snapshot })
  latest.current = { identity, enabled, snapshot }
  const [state, setState] = useState(() => empty(identity))
  const cache = useRef(new Map<string, LearningResult>())
  const active = useRef<{
    key: string
    controller: AbortController
    offset?: number
  } | null>(null)
  const failed = useRef<string | null>(null)
  const current =
    enabled && state.identity === identity ? state : empty(identity)
  const ranges = snapshot
    ? sentenceRanges(snapshot.translation, snapshot.target)
    : []
  const cancel = useCallback(() => {
    active.current?.controller.abort()
    active.current = null
  }, [])
  const close = useCallback(() => {
    cancel()
    setState((s) => ({
      ...s,
      isOpen: false,
      status: s.status === 'loading' ? 'idle' : s.status,
      minimized: false,
      chunk: null,
    }))
  }, [cancel])
  useLayoutEffect(() => {
    cancel()
    failed.current = null
    setState(empty(identity))
    return cancel
  }, [identity, enabled, cancel])
  useEffect(() => {
    window.addEventListener('pagehide', close)
    return () => window.removeEventListener('pagehide', close)
  }, [close])

  const request = useCallback(
    (sentence: number, offset?: number, retry = false) => {
      const live = latest.current
      if (!live.enabled || !live.snapshot) return
      const range = sentenceRanges(
        live.snapshot.translation,
        live.snapshot.target,
      )[sentence]
      if (!range) return
      const data = {
        ...live.snapshot,
        sentenceStart: range.start,
        sentenceEnd: range.end,
      }
      const key = JSON.stringify([live.identity, range])
      const choose = (result: LearningResult) =>
        offset === undefined
          ? null
          : result.chunks.findIndex((c) => offset >= c.start && offset < c.end)
      const show = (result: LearningResult) =>
        setState({
          ...empty(live.identity),
          isOpen: true,
          status: 'ready',
          result,
          sentence,
          chunk: choose(result),
        })
      const cached = cache.current.get(key)
      if (cached) {
        cache.current.delete(key)
        cache.current.set(key, cached)
        show(cached)
        return
      }
      if (active.current?.key === key) {
        active.current.offset = offset
        return
      }
      if (!retry && failed.current === key) {
        setState((s) => ({ ...s, isOpen: true, minimized: false }))
        return
      }
      cancel()
      setState({
        ...empty(live.identity),
        isOpen: true,
        status: 'loading',
        sentence,
      })
      if (!LearningInput.safeParse(data).success) {
        failed.current = key
        setState((s) => ({ ...s, status: 'error', error: 'learningTooLong' }))
        return
      }
      const pending = { key, controller: new AbortController(), offset }
      active.current = pending
      const isCurrent = () =>
        active.current === pending &&
        latest.current.identity === live.identity &&
        latest.current.enabled &&
        !pending.controller.signal.aborted
      void (async () => {
        try {
          const result = await invoke({
            data,
            signal: pending.controller.signal,
          })
          if (!isCurrent()) return
          cache.current.set(key, result)
          if (cache.current.size > 20)
            cache.current.delete(cache.current.keys().next().value!)
          failed.current = null
          const idx =
            pending.offset === undefined
              ? null
              : result.chunks.findIndex(
                  (c) => pending.offset! >= c.start && pending.offset! < c.end,
                )
          setState({
            ...empty(live.identity),
            isOpen: true,
            status: 'ready',
            result,
            sentence,
            chunk: idx,
          })
        } catch {
          if (isCurrent()) {
            failed.current = key
            setState((s) => ({
              ...s,
              status: 'error',
              error: 'learningFailed',
            }))
          }
        } finally {
          if (active.current === pending) active.current = null
        }
      })()
    },
    [invoke, cancel],
  )

  const openAt = useCallback(
    (offset?: number) => {
      const live = latest.current.snapshot
      if (!live) return
      const all = sentenceRanges(live.translation, live.target)
      const index =
        offset === undefined
          ? 0
          : all.findIndex((r) => offset >= r.start && offset < r.end)
      request(Math.max(0, index), offset)
    },
    [request],
  )
  return {
    ...current,
    ranges,
    selectedSentence: current.sentence,
    selectedChunk: current.result?.chunks[current.chunk ?? -1] ?? null,
    openAt,
    close,
    retry: () => request(current.sentence, undefined, true),
    selectSentence: (index: number) => request(index),
    selectChunk: (index: number | null) =>
      setState((s) => ({ ...s, chunk: index, minimized: false })),
    setMinimized: (minimized: boolean) =>
      setState((s) => ({ ...s, minimized })),
  }
}
