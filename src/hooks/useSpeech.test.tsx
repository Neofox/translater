// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpeech } from './useSpeech'
import { UiLangProvider } from './useUiLang'
import type { SpeechChunk } from '../server/speechTypes'

const transport = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('../server/speech', () => ({ speak: transport }))

const contexts: FakeAudioContext[] = []
class FakeAudioContext {
  currentTime = 0
  destination = {}
  sources: Array<{
    onended: null | (() => void)
    stop: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
  }> = []
  resume = vi.fn(() => Promise.resolve())
  close = vi.fn(() => Promise.resolve())
  constructor() {
    contexts.push(this)
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return {
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    }
  }
  createBufferSource() {
    const source = {
      onended: null as null | (() => void),
      stop: vi.fn(),
      disconnect: vi.fn(),
      connect: vi.fn(),
      start: vi.fn(),
    }
    this.sources.push(source)
    return source
  }
}
const base = { text: 'speech test', language: 'en' }
function wrapper({ children }: { children: React.ReactNode }) {
  return <UiLangProvider>{children}</UiLangProvider>
}
function stream(chunks: SpeechChunk[]) {
  return new ReadableStream<SpeechChunk>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
      controller.close()
    },
  })
}
const complete: SpeechChunk[] = [
  { type: 'audio', audio: new Uint8Array([0, 0]), sampleRate: 24000 },
  { type: 'done' },
]

describe('useSpeech', () => {
  beforeEach(() => {
    contexts.length = 0
    localStorage.clear()
    transport
      .mockReset()
      .mockImplementation(() => Promise.resolve(stream(complete)))
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('never autoplays, unlocks within the tap, and waits for audible completion', async () => {
    const { result } = renderHook(
      () => useSpeech({ ...base, text: 'explicit tap' }),
      { wrapper },
    )
    expect(transport).not.toHaveBeenCalled()
    act(() => {
      result.current.start()
      expect(contexts[0]!.resume).toHaveBeenCalledOnce()
      expect(transport).not.toHaveBeenCalled()
    })
    await act(async () => {})
    expect(result.current.status).toBe('playing')
    act(() => contexts[0]!.sources[0]!.onended!())
    await act(async () => {})
    expect(result.current.status).toBe('idle')
  })

  it('replays completed audio without another request', async () => {
    const { result } = renderHook(
      () => useSpeech({ ...base, text: 'cached speech' }),
      { wrapper },
    )
    await act(async () => {
      result.current.start()
    })
    await act(async () => {
      contexts[0]!.sources[0]!.onended!()
    })
    await act(async () => {
      result.current.start()
    })
    expect(transport).toHaveBeenCalledOnce()
    expect(contexts[1]!.sources).toHaveLength(1)
    expect(result.current.status).toBe('playing')
  })

  it('aborts while connecting and rejects a stale resolved stream', async () => {
    let resolve!: (value: ReadableStream<SpeechChunk>) => void
    let signal!: AbortSignal
    const cancel = vi.fn()
    transport.mockImplementationOnce((request) => {
      signal = request.signal
      return new Promise<ReadableStream<SpeechChunk>>((r) => {
        resolve = r
      })
    })
    const { result } = renderHook(
      () => useSpeech({ ...base, text: 'connecting' }),
      { wrapper },
    )
    await act(async () => {
      result.current.start()
    })
    act(() => result.current.stop())
    expect(signal.aborted).toBe(true)
    await act(async () => {
      resolve(new ReadableStream({ cancel }))
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(contexts[0]!.sources).toHaveLength(0)
    expect(result.current.status).toBe('idle')
  })

  it('never sends a request if stopped during slow audio unlock', async () => {
    let resume!: () => void
    vi.stubGlobal(
      'AudioContext',
      class extends FakeAudioContext {
        override resume = vi.fn(
          () =>
            new Promise<void>((r) => {
              resume = r
            }),
        )
      },
    )
    const { result } = renderHook(
      () => useSpeech({ ...base, text: 'slow unlock' }),
      { wrapper },
    )
    act(() => result.current.start())
    act(() => result.current.stop())
    await act(async () => {
      resume()
    })
    expect(transport).not.toHaveBeenCalled()
  })

  it('closes a context whose synchronous unlock fails', () => {
    vi.stubGlobal(
      'AudioContext',
      class extends FakeAudioContext {
        override resume = vi.fn(() => {
          throw new Error('gesture denied')
        })
      },
    )
    const { result } = renderHook(
      () => useSpeech({ ...base, text: 'denied unlock' }),
      { wrapper },
    )
    act(() => result.current.start())
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
    expect(result.current.error).toBe('speechUnavailable')
    expect(transport).not.toHaveBeenCalled()
  })

  it('sends the selected language and falls back to auto for unknown result languages', async () => {
    const { result } = renderHook(
      () => useSpeech({ text: 'unknown result language', language: 'other' }),
      { wrapper },
    )
    await act(async () => {
      result.current.start()
    })
    expect(transport.mock.calls[0]![0].data).toEqual({
      text: 'unknown result language',
      language: 'auto',
      uiLang: 'en',
    })
  })

  it.each(['text', 'language', 'resetKey', 'disabled'] as const)(
    'cancels playing audio when %s changes',
    async (field) => {
      const { result, rerender } = renderHook((props) => useSpeech(props), {
        initialProps: {
          ...base,
          text: `changes ${field}`,
          resetKey: '',
          disabled: false,
        },
        wrapper,
      })
      await act(async () => {
        result.current.start()
      })
      rerender({
        ...base,
        text: `changes ${field}`,
        resetKey: '',
        disabled: false,
        [field]: field === 'disabled' ? true : 'changed',
      })
      expect(contexts[0]!.sources[0]!.stop).toHaveBeenCalledOnce()
      expect(result.current.status).toBe('idle')
    },
  )

  it('cancels a waiting reader on unmount', async () => {
    const cancel = vi.fn()
    transport.mockResolvedValueOnce(new ReadableStream({ cancel }))
    const { result, unmount } = renderHook(
      () => useSpeech({ ...base, text: 'unmount' }),
      { wrapper },
    )
    await act(async () => {
      result.current.start()
    })
    unmount()
    expect(cancel).toHaveBeenCalledOnce()
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
  })

  it('cancels on pagehide even when React stays mounted for the back-forward cache', async () => {
    const cancel = vi.fn()
    transport.mockResolvedValueOnce(
      new ReadableStream<SpeechChunk>({
        start(controller) {
          controller.enqueue(complete[0]!)
        },
        cancel,
      }),
    )
    const { result } = renderHook(
      () => useSpeech({ ...base, text: 'pagehide while playing' }),
      { wrapper },
    )
    await act(async () => {
      result.current.start()
    })
    expect(result.current.status).toBe('playing')
    const signal = transport.mock.calls[0]![0].signal as AbortSignal
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(signal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(contexts[0]!.sources[0]!.stop).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('idle')
    act(() => window.dispatchEvent(new Event('pageshow')))
    await act(async () => {})
    expect(transport).toHaveBeenCalledOnce()
  })

  it('rejects oversized translation output before unlocking audio or requesting speech', () => {
    const { result } = renderHook(
      () => useSpeech({ ...base, text: 'x'.repeat(4001) }),
      { wrapper },
    )
    act(() => result.current.start())
    expect(result.current.error).toBe('speechTooLong')
    expect(contexts).toHaveLength(0)
    expect(transport).not.toHaveBeenCalled()
  })

  it.each(
    [
      [{ type: 'audio', audio: new Uint8Array([0, 0]), sampleRate: 24000 }],
      [
        { type: 'audio', audio: new Uint8Array([0]), sampleRate: 24000 },
        { type: 'done' },
      ],
    ].map((chunks) => ({ chunks: chunks as SpeechChunk[] })),
  )('does not cache malformed or truncated streams', async ({ chunks }) => {
    transport.mockImplementation(() => Promise.resolve(stream(chunks)))
    const { result } = renderHook(
      () => useSpeech({ ...base, text: `invalid ${chunks.length}` }),
      { wrapper },
    )
    await act(async () => {
      result.current.start()
    })
    expect(result.current.error).toBe('speechFailed')
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
    await act(async () => {
      result.current.start()
    })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('keeps raw provider failures out of the visible error', async () => {
    transport.mockRejectedValueOnce(new Error('secret token and source input'))
    const { result } = renderHook(
      () => useSpeech({ ...base, text: 'error privacy' }),
      { wrapper },
    )
    await act(async () => {
      result.current.start()
    })
    expect(result.current.error).toBe('speechFailed')
    expect(result.current.status).toBe('idle')
  })

  it('evicts old completed replays rather than retaining unlimited entries', async () => {
    const { result, rerender } = renderHook((props) => useSpeech(props), {
      initialProps: { ...base, text: 'cache bounded 0' },
      wrapper,
    })
    for (let index = 0; index < 4; index++) {
      rerender({ ...base, text: `cache bounded ${index}` })
      await act(async () => {
        result.current.start()
      })
      await act(async () => {
        contexts[index]!.sources[0]!.onended!()
      })
    }
    expect(transport).toHaveBeenCalledTimes(4)
    rerender({ ...base, text: 'cache bounded 0' })
    await act(async () => {
      result.current.start()
    })
    expect(transport).toHaveBeenCalledTimes(5)
  })

  it('keeps the replay cache bounded by audio bytes as well as entry count', async () => {
    transport.mockImplementation(() =>
      Promise.resolve(
        stream([
          {
            type: 'audio',
            audio: new Uint8Array(3 * 1024 * 1024),
            sampleRate: 24000,
          },
          { type: 'done' },
        ]),
      ),
    )
    const { result, rerender } = renderHook((props) => useSpeech(props), {
      initialProps: { ...base, text: 'large replay first' },
      wrapper,
    })
    await act(async () => {
      result.current.start()
    })
    await act(async () => {
      contexts[0]!.sources[0]!.onended!()
    })
    rerender({ ...base, text: 'large replay second' })
    await act(async () => {
      result.current.start()
    })
    await act(async () => {
      contexts[1]!.sources[0]!.onended!()
    })
    rerender({ ...base, text: 'large replay first' })
    await act(async () => {
      result.current.start()
    })
    expect(transport).toHaveBeenCalledTimes(3)
  })

  it('separates replays for identical text in different languages', async () => {
    const { result, rerender } = renderHook((props) => useSpeech(props), {
      initialProps: { text: 'same text distinct language', language: 'en' },
      wrapper,
    })
    await act(async () => {
      result.current.start()
    })
    await act(async () => {
      contexts[0]!.sources[0]!.onended!()
    })
    rerender({ text: 'same text distinct language', language: 'ko' })
    await act(async () => {
      result.current.start()
    })
    expect(
      transport.mock.calls.map(([request]) => request.data.language),
    ).toEqual(['en', 'ko'])
  })
})
