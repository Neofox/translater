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
it('segments and enriches the Korean source when English is the fluent target language', async () => {
  vi.mocked(learn).mockResolvedValue(output)
  const reading = {
    ...snapshot,
    text: '오늘 도와줘서 고마워요.',
    translation: 'Thanks.',
    source: 'ko',
    target: 'en',
    side: 'source' as const,
    sentenceEnd: 13,
  }
  const { result } = renderHook(() =>
    useLearning({ snapshot: reading, requestKey: 'reading', enabled: true }),
  )
  expect(result.current.ranges).toEqual([{ start: 0, end: 13 }])
  act(() => result.current.openAt(8))
  await waitFor(() => expect(learn).toHaveBeenCalledTimes(1))
  expect(vi.mocked(learn).mock.calls[0]?.[0].data).toMatchObject({
    text: reading.text,
    translation: 'Thanks.',
    side: 'source',
    sentenceStart: 0,
    sentenceEnd: 13,
  })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
it('exposes prepared meanings before opening and fetches deeper facts only on explicit expansion', async () => {
  vi.mocked(learn).mockResolvedValue({
    ...output,
    chunks: [{ ...output.chunks[0]!, grammar: 'An informal greeting.' }],
  })
  const { result } = renderHook(() =>
    useLearning({ ...props, prepared: output }),
  )
  expect(result.current.result?.chunks[0]?.gloss).toBe('hello')
  expect(learn).not.toHaveBeenCalled()
  act(() => result.current.openAt(1))
  expect(result.current.selectedChunk?.gloss).toBe('hello')
  expect(result.current.isBasic).toBe(true)
  expect(learn).not.toHaveBeenCalled()
  act(() => result.current.loadDetails())
  await waitFor(() =>
    expect(result.current.selectedChunk?.grammar).toBe('An informal greeting.'),
  )
  expect(learn).toHaveBeenCalledTimes(1)
  expect(result.current.isBasic).toBe(false)
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
it('never starts enrichment for an uncovered sentence in a prepared response', () => {
  vi.mocked(learn).mockResolvedValue(output)
  const { result } = renderHook(() =>
    useLearning({ ...multi, prepared: output }),
  )
  act(() => result.current.selectSentence(1))
  expect(learn).not.toHaveBeenCalled()
  expect(result.current.isBasic).toBe(true)
  act(() => result.current.loadDetails())
  expect(learn).toHaveBeenCalledTimes(1)
})
it('preserves prepared-response provenance when no safe phrase positions can be resolved', () => {
  const { result } = renderHook(() =>
    useLearning({ ...props, prepared: null, hasPreparedMap: true }),
  )
  act(() => result.current.openAt())
  expect(learn).not.toHaveBeenCalled()
  expect(result.current.isBasic).toBe(true)
})
it.each([null, 1])(
  'preserves the newer selection %s when deeper analysis completes',
  async (selection) => {
    let finish!: (r: LearningResult) => void
    vi.mocked(learn).mockImplementation(
      () =>
        new Promise((r) => {
          finish = r
        }),
    )
    const prepared = {
      ...output,
      chunks: [
        output.chunks[0]!,
        {
          ...output.chunks[0]!,
          start: 3,
          end: 5,
          text: '친구',
          gloss: 'friend',
        },
      ],
    }
    const { result } = renderHook(() =>
      useLearning({
        ...props,
        snapshot: { ...snapshot, translation: '안녕 친구', sentenceEnd: 5 },
        prepared,
      }),
    )
    act(() => {
      result.current.openAt(0)
    })
    act(() => {
      result.current.loadDetails()
    })
    act(() => {
      result.current.selectChunk(selection)
    })
    await act(async () => {
      finish(prepared)
    })
    expect(result.current.selectedChunk?.text).toBe(
      selection === null ? undefined : '친구',
    )
  },
)
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
