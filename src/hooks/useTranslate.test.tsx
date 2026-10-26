// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TRANSLATE_DEBOUNCE_MS, useTranslate } from './useTranslate'
import type { LiveResult, TranslateArgs } from './useTranslate'
import { UiLangProvider } from './useUiLang'
import type { SetStateAction } from 'react'
import type * as ReactModule from 'react'
import type { TranslateChunk, TranslateDone } from '../server/translate'

const reactStateInstrumentation = vi.hoisted(() => ({
  nextNullState: 0,
  onLiveSet: undefined as undefined | (() => void),
  transitionDepth: 0,
}))

// Only the network layer is mocked — `useTranslate` itself runs for real, so
// the debounce effect, the `restore` suppression flag, and the error path
// are all exercised end to end.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()

  return {
    ...actual,
    startTransition: ((scope) => {
      reactStateInstrumentation.transitionDepth += 1
      try {
        return actual.startTransition(scope)
      } finally {
        reactStateInstrumentation.transitionDepth -= 1
      }
    }) as typeof actual.startTransition,
    useState: (<TState,>(initialState: TState | (() => TState)) => {
      const state = actual.useState(initialState)
      const isLiveState =
        initialState === null && reactStateInstrumentation.nextNullState++ === 0

      if (!isLiveState) return state

      return [
        state[0],
        (value: SetStateAction<TState>) => {
          reactStateInstrumentation.onLiveSet?.()
          state[1](value)
        },
      ] as typeof state
    }) as typeof actual.useState,
  }
})

vi.mock('@tanstack/react-start', () => ({
  useServerFn: (fn: unknown) => fn,
}))

vi.mock('../server/translate', () => ({
  translate: vi.fn(),
}))

function makeCacheStream(main: string): ReadableStream<TranslateChunk> {
  const done: TranslateDone = {
    intent: 'sentence',
    data: { main, sourceLang: 'fr' } as unknown as TranslateDone['data'],
  } as TranslateDone
  return new ReadableStream<TranslateChunk>({
    start(controller) {
      controller.enqueue({ type: 'cache', done })
      controller.close()
    },
  })
}

function makeStream(chunks: TranslateChunk[]): ReadableStream<TranslateChunk> {
  return new ReadableStream<TranslateChunk>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
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
    reactStateInstrumentation.nextNullState = 0
    reactStateInstrumentation.onLiveSet = undefined
    reactStateInstrumentation.transitionDepth = 0
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
    reactStateInstrumentation.onLiveSet = undefined
    vi.restoreAllMocks()
  })

  it('waits for the full default debounce before translating', async () => {
    renderHook((props: TranslateArgs) => useTranslate(props), {
      initialProps: baseArgs,
      wrapper,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS - 1)
    })
    expect(translateMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(translateMock).toHaveBeenCalledTimes(1)
  })

  it('keeps new-run and streamed text updates urgent while completed results can animate', async () => {
    const phases: string[] = []
    translateMock.mockResolvedValueOnce(
      makeStream([
        { type: 'delta', raw: '{"main":"안녕"}' },
        {
          type: 'done',
          done: {
            intent: 'sentence',
            data: { main: '안녕', sourceLang: 'en', targetLang: 'ko' },
          } as TranslateDone,
        },
      ]),
    )
    reactStateInstrumentation.onLiveSet = () => {
      phases.push(
        reactStateInstrumentation.transitionDepth ? 'transition' : 'urgent',
      )
    }
    const { result } = renderHook(
      (props: TranslateArgs) => useTranslate(props, { debounceMs: 0 }),
      { initialProps: baseArgs, wrapper },
    )
    await act(async () => {
      await result.current.run()
    })
    expect(phases).toEqual(['urgent', 'urgent', 'transition'])
    expect(result.current.live).toMatchObject({
      done: true,
      partial: { main: '안녕' },
      text: baseArgs.text,
    })
  })

  it('preserves Auto request provenance and reports a streaming sourceLang', async () => {
    const trace: string[] = []
    const onSourceDetected = vi.fn(() => trace.push('source'))
    translateMock.mockResolvedValueOnce(
      makeStream([{ type: 'delta', raw: '{"sourceLang":"fr"}' }]),
    )
    reactStateInstrumentation.nextNullState = 0
    reactStateInstrumentation.onLiveSet = () => trace.push('live')
    const { result } = renderHook(
      (props: TranslateArgs) =>
        useTranslate(props, { debounceMs: 0, onSourceDetected }),
      { initialProps: { ...baseArgs, source: 'auto' }, wrapper },
    )
    trace.length = 0

    await act(async () => {
      await result.current.run()
    })

    expect(trace).toEqual(['live', 'source', 'live'])
    expect(result.current.live).toMatchObject({
      done: false,
      requestSource: 'auto',
      text: 'see you tomorrow',
      partial: { sourceLang: 'fr' },
    })
    expect(onSourceDetected).toHaveBeenCalledWith({
      text: 'see you tomorrow',
      requestSource: 'auto',
      sourceLang: 'fr',
    })
  })

  it('reports sourceLang from a cache-only final result before publishing it', async () => {
    const trace: string[] = []
    const onSourceDetected = vi.fn(() => trace.push('source'))
    reactStateInstrumentation.nextNullState = 0
    reactStateInstrumentation.onLiveSet = () => trace.push('live')
    const { result } = renderHook(
      (props: TranslateArgs) =>
        useTranslate(props, { debounceMs: 0, onSourceDetected }),
      { initialProps: { ...baseArgs, source: 'auto' }, wrapper },
    )
    trace.length = 0

    await act(async () => {
      await result.current.run()
    })

    expect(trace).toEqual(['live', 'source', 'live'])
    expect(result.current.live).toMatchObject({
      done: true,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })
    expect(onSourceDetected).toHaveBeenCalledWith({
      text: 'see you tomorrow',
      requestSource: 'auto',
      sourceLang: 'fr',
    })
  })

  it('aborts an in-flight request when the input changes', async () => {
    let firstSignal: AbortSignal | undefined
    translateMock.mockImplementationOnce(
      (request: { signal?: AbortSignal }) => {
        firstSignal = request.signal
        return Promise.resolve(
          new ReadableStream<TranslateChunk>({
            start(controller) {
              request.signal?.addEventListener('abort', () => {
                controller.error(new DOMException('Aborted', 'AbortError'))
              })
            },
          }),
        )
      },
    )

    const { rerender } = renderHook(
      (props: TranslateArgs) => useTranslate(props),
      { initialProps: baseArgs, wrapper },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS)
    })
    expect(firstSignal?.aborted).toBe(false)

    rerender({ ...baseArgs, text: 'see you tomorrow!' })
    expect(firstSignal?.aborted).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS)
    })

    const [firstRequest, replacementRequest] = translateMock.mock.calls.map(
      ([request]) => request.data,
    )
    expect(replacementRequest.analyticsSupersedesRunId).toBe(
      firstRequest.analyticsRunId,
    )
    expect(replacementRequest.analyticsInputRevision).toBe(2)
    expect(replacementRequest.analyticsTrigger).toBe('debounce')
  })

  it('changing args.refinements schedules a run after the debounce window', async () => {
    const { rerender } = renderHook(
      (props: TranslateArgs) => useTranslate(props),
      { initialProps: baseArgs, wrapper },
    )

    // Mount itself schedules a debounced run for the initial non-empty text —
    // let it fire and settle before isolating the assertion to the change.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS)
    })
    expect(translateMock).toHaveBeenCalledTimes(1)
    translateMock.mockClear()

    rerender({ ...baseArgs, refinements: ['make it softer'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS)
    })

    expect(translateMock).toHaveBeenCalledTimes(1)
  })

  it('groups page-lifetime requests under one anonymous session', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000001'
    const firstRunId = '00000000-0000-4000-8000-000000000002'
    const secondRunId = '00000000-0000-4000-8000-000000000003'
    vi.spyOn(window.crypto, 'randomUUID')
      .mockReturnValueOnce(sessionId)
      .mockReturnValueOnce(firstRunId)
      .mockReturnValueOnce(secondRunId)
    const { result } = renderHook(
      (props: TranslateArgs) => useTranslate(props),
      { initialProps: baseArgs, wrapper },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS)
    })
    await act(async () => {
      await result.current.run()
    })

    const requests = translateMock.mock.calls.map(([request]) => request.data)
    expect(requests.map((request) => request.analyticsSessionId)).toEqual([
      sessionId,
      sessionId,
    ])
    expect(requests.map((request) => request.analyticsRunId)).toEqual([
      firstRunId,
      secondRunId,
    ])
    expect(requests.map((request) => request.analyticsTrigger)).toEqual([
      'debounce',
      'force',
    ])
    expect(requests.map((request) => request.analyticsInputRevision)).toEqual([
      1, 1,
    ])
  })

  it('restore() + refinements change in the same act suppresses the scheduled run', async () => {
    const { result, rerender } = renderHook(
      (props: TranslateArgs) => useTranslate(props),
      { initialProps: baseArgs, wrapper },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS)
    })
    translateMock.mockClear()

    // Simulate an add-refinement action: refinements change, its run fires.
    rerender({ ...baseArgs, refinements: ['make it softer'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS)
    })
    expect(translateMock).toHaveBeenCalledTimes(1)
    translateMock.mockClear()

    const snapshot: LiveResult = {
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      requestSource: 'en',
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
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS)
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
      await vi.advanceTimersByTimeAsync(DEFAULT_TRANSLATE_DEBOUNCE_MS)
    })
    translateMock.mockClear()
    translateMock.mockRejectedValueOnce(new Error('boom'))

    await act(async () => {
      await result.current.run()
    })

    expect(result.current.error?.kind).toBe('server')
  })
})
