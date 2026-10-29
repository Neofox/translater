import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { LearningInputData, LearningResult } from '../server/learningTypes'

type Options = {
  snapshot: LearningInputData | null
  requestKey: string | null
  enabled: boolean
  prepared?: LearningResult | null
  hasPreparedMap?: boolean
}
type State = {
  identity: string
  isOpen: boolean
  minimized: boolean
  chunk: number | null
}
const empty = (identity: string): State => ({
  identity,
  isOpen: false,
  minimized: false,
  chunk: null,
})

/** Local navigation over the initial translation response. No request transport. */
export function useLearning({
  snapshot,
  requestKey,
  enabled,
  prepared,
  hasPreparedMap = Boolean(prepared),
}: Options) {
  const identity = JSON.stringify([requestKey, snapshot])
  const [state, setState] = useState(() => empty(identity))
  const current =
    enabled && state.identity === identity ? state : empty(identity)
  const result = enabled ? (prepared ?? null) : null
  const close = useCallback(
    () =>
      setState((s) => ({ ...s, isOpen: false, minimized: false, chunk: null })),
    [],
  )
  useLayoutEffect(() => {
    setState(empty(identity))
  }, [identity, enabled])
  useEffect(() => {
    window.addEventListener('pagehide', close)
    return () => window.removeEventListener('pagehide', close)
  }, [close])
  return {
    ...current,
    result,
    status: result ? ('ready' as const) : ('idle' as const),
    hasPreparedMap,
    selectedChunk: result?.chunks[current.chunk ?? -1] ?? null,
    openAt: (offset?: number) => {
      if (!result) return
      const index =
        offset === undefined
          ? -1
          : result.chunks.findIndex((c) => offset >= c.start && offset < c.end)
      setState({
        ...empty(identity),
        isOpen: true,
        chunk: index < 0 ? null : index,
      })
    },
    close,
    selectChunk: (index: number | null) => {
      if (!result || (index !== null && !result.chunks[index])) return
      setState({
        ...current,
        identity,
        isOpen: true,
        chunk: index,
        minimized: false,
      })
    },
    setMinimized: (minimized: boolean) =>
      setState({ ...current, identity, minimized }),
  }
}
