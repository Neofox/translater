// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStreamingText } from './useStreamingText'

let reduced = false
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16),
  )
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  reduced = false
})
it('interpolates streamed bursts in graphemes and catches up within 120ms', () => {
  const text = '👨‍👩‍👧‍👦 안녕하세요 é'
  const { result } = renderHook(() => useStreamingText(text, true, 'a'))
  act(() => vi.advanceTimersByTime(32))
  expect(result.current.text.length).toBeGreaterThan(0)
  expect(result.current.text.length).toBeLessThan(text.length)
  const prefixes = [
    ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
  ].map((p) => text.slice(0, p.index + p.segment.length))
  expect(prefixes).toContain(result.current.text)
  act(() => vi.advanceTimersByTime(96))
  expect(result.current.text).toBe(text)
})
it('flushes synchronously when main is ready, and discards the old request on replacement', () => {
  const { result, rerender } = renderHook(
    ({ text, active, key }) => useStreamingText(text, active, key),
    { initialProps: { text: 'first text', active: true, key: 'a' } },
  )
  rerender({ text: 'first text complete', active: false, key: 'a' })
  expect(result.current.text).toBe('first text complete')
  rerender({ text: 'new answer', active: true, key: 'b' })
  expect(result.current.text).toBe('')
  act(() => vi.advanceTimersByTime(120))
  expect(result.current.text).toBe('new answer')
})
it('keeps live text immediate for reduced motion and after native selection starts', () => {
  reduced = true
  const { result, rerender } = renderHook(
    ({ text, key }) => useStreamingText(text, true, key),
    { initialProps: { text: '안녕하세요', key: 'a' } },
  )
  expect(result.current.text).toBe('안녕하세요')
  reduced = false
  rerender({ text: 'select this text', key: 'b' })
  act(() => result.current.revealAll())
  expect(result.current.text).toBe('select this text')
  rerender({ text: 'select this text with another token', key: 'b' })
  expect(result.current.text).toBe('select this text with another token')
})

it('skips the backlog when a background tab becomes visible again', () => {
  const { result } = renderHook(() =>
    useStreamingText('new streamed answer', true, 'a'),
  )
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(result.current.text).toBe('new streamed answer')
})
