import { describe, expect, it, vi } from 'vitest'
import { MAX_AUDIO_BYTES, PcmPlayer } from './pcmPlayer'

// Web Audio does not run in jsdom/Node. This boundary records actual sample
// buffers and scheduling while the real decoder and completion logic run.
export function audioHarness() {
  const sources: Array<{
    buffer: { duration: number; samples: Float32Array } | null
    onended: (() => void) | null
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
  }> = []
  const context = {
    currentTime: 1,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createBuffer: vi.fn((_channels: number, length: number, rate: number) => ({
      duration: length / rate,
      samples: new Float32Array(length),
      getChannelData() {
        return this.samples
      },
    })),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null,
        onended: null,
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        connect: vi.fn(),
      }
      sources.push(source)
      return source
    }),
  }
  return {
    context,
    sources,
    player: () => new PcmPlayer(context as unknown as AudioContext),
  }
}

describe('PCM playback', () => {
  it('joins odd byte boundaries and decodes signed little-endian samples', () => {
    const { player, sources } = audioHarness()
    const pcm = player()
    pcm.append(new Uint8Array([0, 128, 255]), 24000)
    pcm.append(new Uint8Array([127, 0, 0]), 24000)
    expect(Array.from(sources[0]!.buffer!.samples)).toEqual([-1])
    expect(Array.from(sources[1]!.buffer!.samples)).toEqual([32767 / 32768, 0])
    expect(sources[1]!.start.mock.calls[0]![0]).toBeCloseTo(1.02 + 1 / 24000)
  })

  it('finishes only after the final scheduled audio ends', async () => {
    const { player, sources } = audioHarness()
    const pcm = player()
    pcm.append(new Uint8Array([0, 0]), 24000)
    let ended = false
    const completion = pcm.endInput().then(() => {
      ended = true
    })
    await Promise.resolve()
    expect(ended).toBe(false)
    sources[0]!.onended!()
    await completion
    expect(ended).toBe(true)
  })

  it('stops queued sources, closes audio, and unblocks completion', async () => {
    const { player, sources, context } = audioHarness()
    const pcm = player()
    pcm.append(new Uint8Array([0, 0]), 24000)
    const completion = pcm.endInput()
    pcm.stop()
    await completion
    expect(sources[0]!.stop).toHaveBeenCalledOnce()
    expect(sources[0]!.disconnect).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('rejects truncated frames, empty output, changed formats, and oversized audio', () => {
    const odd = audioHarness().player()
    odd.append(new Uint8Array([1]), 24000)
    expect(() => odd.endInput()).toThrow()
    expect(() => audioHarness().player().endInput()).toThrow()
    const changed = audioHarness().player()
    changed.append(new Uint8Array([0, 0]), 24000)
    expect(() => changed.append(new Uint8Array([0, 0]), 48000)).toThrow()
    expect(() =>
      audioHarness()
        .player()
        .append(new Uint8Array(MAX_AUDIO_BYTES + 1), 24000),
    ).toThrow()
  })
})
