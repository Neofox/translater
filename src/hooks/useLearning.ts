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
import { learningText, learningLanguage } from '../lib/learningSide'

type Options = {
  snapshot: LearningInputData | null
  requestKey: string | null
  enabled: boolean
  prepared?: LearningResult | null
  hasPreparedMap?: boolean
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
  isBasic: boolean
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
  isBasic: false,
})

export function useLearning({
  snapshot,
  requestKey,
  enabled,
  prepared,
  hasPreparedMap = Boolean(prepared),
}: Options) {
  const invoke = useServerFn(learn)
  const identity = JSON.stringify([requestKey, snapshot])
  const latest = useRef({
    identity,
    enabled,
    snapshot,
    prepared,
    hasPreparedMap,
  })
  latest.current = { identity, enabled, snapshot, prepared, hasPreparedMap }
  const [state, setState] = useState(() => empty(identity))
  const cache = useRef(new Map<string, LearningResult>())
  const active = useRef<{
    key: string
    controller: AbortController
    offset?: number
  } | null>(null)
  // Failure metadata is separate from the completed-result cache: restoring a
  // failed sentence must expose Retry, never silently start another paid run.
  const failed = useRef(new Map<string, 'learningFailed' | 'learningTooLong'>())
  let current = enabled && state.identity === identity ? state : empty(identity)
  const ranges = snapshot
    ? sentenceRanges(learningText(snapshot), learningLanguage(snapshot))
    : []
  const basicFor = (
    range: { start: number; end: number },
    result?: LearningResult | null,
  ) => {
    const chunks =
      result?.chunks.filter(
        (c) => c.start >= range.start && c.end <= range.end,
      ) ?? []
    return chunks.length
      ? { chunks, wordOrder: '', partial: result?.partial ?? false }
      : null
  }
  if (enabled && current.status === 'idle' && ranges[current.sentence]) {
    const basic =
      basicFor(ranges[current.sentence]!, prepared) ??
      (hasPreparedMap ? { chunks: [], wordOrder: '', partial: false } : null)
    if (basic)
      current = { ...current, status: 'ready', result: basic, isBasic: true }
  }
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
    failed.current.clear()
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
        learningText(live.snapshot),
        learningLanguage(live.snapshot),
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
      const show = (result: LearningResult, isBasic = false) =>
        setState({
          ...empty(live.identity),
          isOpen: true,
          status: 'ready',
          result,
          sentence,
          chunk: choose(result),
          isBasic,
        })
      if (active.current?.key !== key) cancel()
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
      const basic =
        basicFor(range, live.prepared) ??
        (live.hasPreparedMap
          ? { chunks: [], wordOrder: '', partial: false }
          : null)
      if (basic && !retry) {
        show(basic, true)
        return
      }
      const failure = failed.current.get(key)
      if (!retry && failure) {
        setState({
          ...empty(live.identity),
          sentence,
          isOpen: true,
          status: 'error',
          error: failure,
        })
        return
      }
      cancel()
      setState({
        ...empty(live.identity),
        isOpen: true,
        status: 'loading',
        sentence,
        result: basic,
        isBasic: Boolean(basic),
        chunk: basic ? choose(basic) : null,
      })
      if (!LearningInput.safeParse(data).success) {
        failed.current.set(key, 'learningTooLong')
        if (failed.current.size > 20)
          failed.current.delete(failed.current.keys().next().value!)
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
          failed.current.delete(key)
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
            isBasic: false,
          })
        } catch {
          if (isCurrent()) {
            failed.current.set(key, 'learningFailed')
            if (failed.current.size > 20)
              failed.current.delete(failed.current.keys().next().value!)
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
      const all = sentenceRanges(learningText(live), learningLanguage(live))
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
    hasPreparedMap,
    ranges,
    selectedSentence: current.sentence,
    selectedChunk: current.result?.chunks[current.chunk ?? -1] ?? null,
    openAt,
    close,
    retry: () => request(current.sentence, undefined, true),
    loadDetails: () =>
      request(
        current.sentence,
        current.result?.chunks[current.chunk ?? -1]?.start,
        true,
      ),
    selectSentence: (index: number) => request(index),
    selectChunk: (index: number | null) => {
      if (active.current)
        active.current.offset =
          index === null ? undefined : current.result?.chunks[index]?.start
      setState((s) => ({ ...s, chunk: index, minimized: false }))
    },
    setMinimized: (minimized: boolean) =>
      setState((s) => ({ ...s, minimized })),
  }
}
