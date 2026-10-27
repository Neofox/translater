// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useLearning } from './useLearning'
import { learn } from '../server/learning'
import type { LearningResult } from '../server/learningTypes'

vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('../server/learning', () => ({ learn: vi.fn() }))
const snapshot = {
  text: 'Hello',
  translation: '안녕',
  sentenceStart: 0,
  sentenceEnd: 2,
  source: 'en',
  target: 'ko',
  mode: 'casual' as const,
  uiLang: 'en' as const,
  context: '',
}
const output: LearningResult = {
  wordOrder: '',
  partial: false,
  chunks: [
    {
      start: 0,
      end: 2,
      text: '안녕',
      sourceSpans: [],
      gloss: 'hello',
      baseForm: '',
      literalMeaning: '',
      naturalMeaning: '',
      grammar: '',
      omissions: '',
    },
  ],
}
const props = { snapshot, requestKey: 'current', enabled: true }
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('fetches only on deliberate open, deduplicates taps, and caches completed results', async () => {
  let finish!: (r: LearningResult) => void
  vi.mocked(learn).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r
      }),
  )
  const { result } = renderHook(() => useLearning(props), {
    wrapper: StrictMode,
  })
  expect(learn).not.toHaveBeenCalled()
  act(() => {
    result.current.openAt(1)
    result.current.openAt(0)
  })
  expect(learn).toHaveBeenCalledTimes(1)
  await act(async () => {
    finish(output)
  })
  expect(result.current.selectedChunk?.text).toBe('안녕')
  act(() => {
    result.current.close()
    result.current.openAt()
  })
  expect(learn).toHaveBeenCalledTimes(1)
  expect(result.current.result?.chunks[0]?.gloss).toBe('hello')
})
it('aborts on edits and ignores a late old response without reopening learning', async () => {
  let finish!: (r: LearningResult) => void
  vi.mocked(learn).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r
      }),
  )
  const { result, rerender } = renderHook((p) => useLearning(p), {
    initialProps: props,
  })
  act(() => result.current.openAt())
  const signal = vi.mocked(learn).mock.calls[0]![0].signal!
  rerender({ ...props, requestKey: 'edited', enabled: false })
  expect(signal.aborted).toBe(true)
  await act(async () => {
    finish(output)
  })
  expect(result.current.isOpen).toBe(false)
  expect(result.current.result).toBeNull()
})
it('keeps failures local and retries only through the explicit retry action', async () => {
  vi.mocked(learn)
    .mockRejectedValueOnce(new Error('untrusted raw input'))
    .mockResolvedValue(output)
  const { result, rerender } = renderHook((p) => useLearning(p), {
    initialProps: props,
  })
  act(() => result.current.openAt())
  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.error).not.toContain('untrusted')
  rerender({ ...props })
  act(() => result.current.openAt())
  expect(learn).toHaveBeenCalledTimes(1)
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(learn).toHaveBeenCalledTimes(2)
})
it('cancels on close and pagehide and never accepts a late completion', async () => {
  let finish!: (r: LearningResult) => void
  vi.mocked(learn).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r
      }),
  )
  const { result } = renderHook(() => useLearning(props))
  act(() => result.current.openAt())
  act(() => window.dispatchEvent(new Event('pagehide')))
  await act(async () => {
    finish(output)
  })
  expect(result.current.isOpen).toBe(false)
  expect(result.current.status).toBe('idle')
})

const multi = {
  ...props,
  snapshot: { ...snapshot, translation: '안녕. 안녕.', sentenceEnd: 7 },
}
it('returning to a cached sentence cancels another sentence request before it can replace the chosen view', async () => {
  let finish!: (r: LearningResult) => void
  vi.mocked(learn)
    .mockResolvedValueOnce(output)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r
        }),
    )
  const { result } = renderHook(() => useLearning(multi))
  act(() => result.current.openAt())
  await waitFor(() => expect(result.current.status).toBe('ready'))
  act(() => result.current.selectSentence(1))
  act(() => result.current.selectSentence(0))
  await act(async () => {
    finish({ ...output, chunks: [{ ...output.chunks[0]!, start: 4, end: 6 }] })
  })
  expect(result.current.selectedSentence).toBe(0)
  expect(result.current.result?.chunks[0]?.start).toBe(0)
})
it('returning to a failed sentence restores its error and Retry rather than another cached sentence', async () => {
  vi.mocked(learn)
    .mockResolvedValueOnce(output)
    .mockRejectedValueOnce(new Error('offline'))
  const { result } = renderHook(() => useLearning(multi))
  act(() => result.current.openAt())
  await waitFor(() => expect(result.current.status).toBe('ready'))
  act(() => result.current.selectSentence(1))
  await waitFor(() => expect(result.current.status).toBe('error'))
  act(() => result.current.selectSentence(0))
  expect(result.current.status).toBe('ready')
  act(() => result.current.selectSentence(1))
  expect(result.current.selectedSentence).toBe(1)
  expect(result.current.status).toBe('error')
  expect(result.current.result).toBeNull()
  expect(learn).toHaveBeenCalledTimes(2)
})
