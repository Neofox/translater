// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTranslate } from './useTranslate'
import type { LiveResult, TranslateArgs } from './useTranslate'
import { UiLangProvider } from './useUiLang'
import type { TranslateChunk, TranslateDone } from '../server/translate'

// Only the network layer is mocked — `useTranslate` itself runs for real, so
// the debounce effect, the `restore` suppression flag, and the error path
// are all exercised end to end.
vi.mock('@tanstack/react-start', () => ({
  useServerFn: (fn: unknown) => fn,
}))

vi.mock('../server/translate', () => ({
  translate: vi.fn(),
}))

function makeCacheStream(main: string): ReadableStream<TranslateChunk> {
  const done: TranslateDone = {
    intent: 'sentence',
    data: { main } as unknown as TranslateDone['data'],
  } as TranslateDone
  return new ReadableStream<TranslateChunk>({
    start(controller) {
      controller.enqueue({ type: 'cache', done })
      controller.close()
    },
  })
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <UiLangProvider>{children}</UiLangProvider>
}

const baseArgs: TranslateArgs = {
  text: 'see you tomorrow',
  source: 'en',
  target: 'ko',
  mode: 'casual',
  intent: 'sentence',
  context: '',
  refinements: [],
  previousMain: '',
}

describe('useTranslate', () => {
  let translateMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.useFakeTimers()
    const mod = (await import('../server/translate')) as unknown as {
      translate: ReturnType<typeof vi.fn>
    }
    translateMock = mod.translate
    translateMock.mockReset()
    translateMock.mockImplementation(() =>
      Promise.resolve(makeCacheStream('내일 봐요')),
    )
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('changing args.refinements schedules a run after the debounce window', async () => {
    const { rerender } = renderHook(
      (props: TranslateArgs) => useTranslate(props),
      { initialProps: baseArgs, wrapper },
    )

    // Mount itself schedules a debounced run for the initial non-empty text —
    // let it fire and settle before isolating the assertion to the change.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(translateMock).toHaveBeenCalledTimes(1)
    translateMock.mockClear()

    rerender({ ...baseArgs, refinements: ['make it softer'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(translateMock).toHaveBeenCalledTimes(1)
  })

  it('groups page-lifetime requests under one anonymous session', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000001'
    vi.spyOn(window.crypto, 'randomUUID').mockReturnValue(sessionId)
    const { result } = renderHook(
      (props: TranslateArgs) => useTranslate(props),
      { initialProps: baseArgs, wrapper },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    await act(async () => {
      await result.current.run()
    })

    expect(
      translateMock.mock.calls.map(
        ([request]) => request.data.analyticsSessionId,
      ),
    ).toEqual([sessionId, sessionId])
  })

  it('restore() + refinements change in the same act suppresses the scheduled run', async () => {
    const { result, rerender } = renderHook(
      (props: TranslateArgs) => useTranslate(props),
      { initialProps: baseArgs, wrapper },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    translateMock.mockClear()

    // Simulate an add-refinement action: refinements change, its run fires.
    rerender({ ...baseArgs, refinements: ['make it softer'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(translateMock).toHaveBeenCalledTimes(1)
    translateMock.mockClear()

    const snapshot: LiveResult = {
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      text: 'see you tomorrow',
    }

    // The undo sequence: restore the pre-refine snapshot and roll the
    // refinements arg back in the same act — this is exactly what
    // TranslatorContext.undoRefine does.
    act(() => {
      result.current.restore(snapshot)
      rerender({ ...baseArgs, refinements: [] })
    })

    expect(result.current.live).toEqual(snapshot)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(translateMock).not.toHaveBeenCalled()
    expect(result.current.live).toEqual(snapshot)
  })

  it('a non-abort translateFn rejection surfaces as a server error', async () => {
    const { result } = renderHook(
      (props: TranslateArgs) => useTranslate(props),
      { initialProps: baseArgs, wrapper },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    translateMock.mockClear()
    translateMock.mockRejectedValueOnce(new Error('boom'))

    await act(async () => {
      await result.current.run()
    })

    expect(result.current.error?.kind).toBe('server')
  })
})
