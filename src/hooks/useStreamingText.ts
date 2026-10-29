import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'

const query = '(prefers-reduced-motion: reduce)'
const reducedSnapshot = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(query).matches
const subscribe = (notify: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(query)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}
const serverSnapshot = () => false

/** Interpolate token bursts for at most 100ms. Model/action state is untouched. */
export function useStreamingText(text: string, active: boolean, key: string) {
  const reduced = useSyncExternalStore(
    subscribe,
    reducedSnapshot,
    serverSnapshot,
  )
  const [shown, setShown] = useState(() => ({
    key,
    text: active ? '' : text,
    immediate: false,
  }))
  const immediate = !active || reduced || (shown.key === key && shown.immediate)
  const visible = immediate
    ? text
    : shown.key === key && text.startsWith(shown.text)
      ? shown.text
      : ''
  const revealAll = useCallback(
    () => setShown({ key, text, immediate: true }),
    [key, text],
  )
  useEffect(() => {
    const reveal = () => {
      if (!document.hidden) revealAll()
    }
    document.addEventListener('visibilitychange', reveal)
    return () => document.removeEventListener('visibilitychange', reveal)
  }, [revealAll])
  useLayoutEffect(() => {
    if (immediate) return
    const from =
      shown.key === key && text.startsWith(shown.text) ? shown.text.length : 0
    const ends = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
        text,
      ),
    ]
      .map((p) => p.index + p.segment.length)
      .filter((end) => end > from)
    if (!ends.length) return
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 100)
      const count = Math.max(1, Math.ceil(ends.length * progress))
      setShown({ key, text: text.slice(0, ends[count - 1]), immediate: false })
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // Start a new bounded interpolation only when the provider adds text or the
    // request/motion policy changes, never for the animation's own frames.
  }, [text, key, immediate])
  return { text: visible, revealAll }
}
