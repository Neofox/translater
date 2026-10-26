import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleSpeech, resolveSpeechConfig } from './speech.server'
import {
  MAX_SPEECH_AUDIO_BYTES,
  MAX_SPEECH_CHARS,
  SpeechInput,
} from './speechTypes'
import type { SpeechChunk } from './speechTypes'
import type * as AiSdk from 'ai'

const sdk = vi.hoisted(() => ({
  generateSpeech: vi.fn(),
  streamSpeech: vi.fn(() => {
    throw new Error('Gateway does not support WebSocket speech')
  }),
}))
vi.mock('ai', () => ({
  generateSpeech: sdk.generateSpeech,
  experimental_streamSpeech: sdk.streamSpeech,
}))
const input = {
  text: '  안녕하세요  ',
  language: 'ko' as const,
  uiLang: 'en' as const,
}

function wav(
  bytes = new Uint8Array([1, 0, 2, 0]),
  options: {
    rate?: number
    channels?: number
    bits?: number
    format?: number
    metadata?: boolean
  } = {},
) {
  const rate = options.rate ?? 24000,
    channels = options.channels ?? 1,
    bits = options.bits ?? 16
  const result = new Uint8Array(
    44 + bytes.length + (bytes.length % 2) + (options.metadata ? 12 : 0),
  )
  const view = new DataView(result.buffer)
  const tag = (at: number, value: string) =>
    result.set(new TextEncoder().encode(value), at)
  tag(0, 'RIFF')
  view.setUint32(4, result.length - 8, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, options.format ?? 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, (rate * channels * bits) / 8, true)
  view.setUint16(32, (channels * bits) / 8, true)
  view.setUint16(34, bits, true)
  tag(36, 'data')
  view.setUint32(40, bytes.length, true)
  result.set(bytes, 44)
  if (options.metadata) {
    tag(44 + bytes.length + (bytes.length % 2), 'C2PA')
    view.setUint32(48 + bytes.length + (bytes.length % 2), 4, true)
    result.set([80, 82, 73, 86], result.length - 4)
  }
  return result
}
async function collect(stream: ReadableStream<SpeechChunk>) {
  const result: SpeechChunk[] = []
  for await (const chunk of stream) result.push(chunk)
  return result
}
function deferred() {
  let resolve!: (value: { audio: { uint8Array: Uint8Array } }) => void
  const promise = new Promise<{ audio: { uint8Array: Uint8Array } }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  sdk.generateSpeech.mockReset()
  sdk.streamSpeech.mockClear()
  sdk.generateSpeech.mockResolvedValue({ audio: { uint8Array: wav() } })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('speech input and deployment configuration', () => {
  it('trims text and rejects empty, oversized or unsupported-language input', () => {
    expect(SpeechInput.parse(input).text).toBe('안녕하세요')
    for (const text of ['', ' ', 'a'.repeat(MAX_SPEECH_CHARS + 1)])
      expect(SpeechInput.safeParse({ ...input, text }).success).toBe(false)
    expect(
      SpeechInput.safeParse({ ...input, text: 'a'.repeat(4000) }).success,
    ).toBe(true)
    expect(
      SpeechInput.safeParse({ ...input, language: 'invalid' }).success,
    ).toBe(false)
  })
  it('uses the chosen default and permits exact deployment model/voice overrides', () => {
    expect(resolveSpeechConfig({})).toEqual({
      model: 'google/gemini-3.8-flash-lite-tts',
      voice: 'Kore',
    })
    expect(
      resolveSpeechConfig({
        SPEECH_MODEL: ' google/other ',
        SPEECH_VOICE: ' Aoede ',
      }),
    ).toEqual({ model: 'google/other', voice: 'Aoede' })
    expect(resolveSpeechConfig({ SPEECH_MODEL: 'vendor/tts' })).toEqual({
      model: 'vendor/tts',
    })
  })
  it.each([
    '',
    'google',
    'google/one/google/two',
    'google/model other',
    'google/model,other',
    'google/\nmodel',
  ])('rejects ambiguous model configuration %j', (model) => {
    expect(() => resolveSpeechConfig({ SPEECH_MODEL: model })).toThrow()
  })
  it.each([' ', 'x'.repeat(201), 'voice\u0000id'])(
    'rejects invalid voice configuration %#',
    (voice) => {
      expect(() => resolveSpeechConfig({ SPEECH_VOICE: voice })).toThrow()
    },
  )
})

describe('Gateway HTTPS speech boundary', () => {
  it('uses supported HTTPS generation and strips WAV headers/metadata before PCM playback', async () => {
    sdk.generateSpeech.mockResolvedValue({
      audio: { uint8Array: wav(undefined, { metadata: true }) },
      providerMetadata: { private: 'PRIVATE BODY' },
    })
    expect(
      await collect(
        await handleSpeech(input, new AbortController().signal, { env: {} }),
      ),
    ).toEqual([
      { type: 'audio', audio: new Uint8Array([1, 0, 2, 0]), sampleRate: 24000 },
      { type: 'done' },
    ])
    expect(sdk.streamSpeech).not.toHaveBeenCalled()
    expect(sdk.generateSpeech).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        model: 'google/gemini-3.8-flash-lite-tts',
        voice: 'Kore',
        text: '안녕하세요',
        outputFormat: 'wav',
        maxRetries: 0,
        telemetry: {
          isEnabled: false,
          recordInputs: false,
          recordOutputs: false,
        },
      }),
    )
    expect(sdk.generateSpeech.mock.calls[0]![0]).not.toHaveProperty('language')
  })
  it('uses the selected non-Google model with its supported language option', async () => {
    await collect(
      await handleSpeech(input, new AbortController().signal, {
        env: { SPEECH_MODEL: 'vendor/tts', SPEECH_VOICE: 'voice-id' },
      }),
    )
    expect(sdk.generateSpeech.mock.calls[0]![0]).toMatchObject({
      model: 'vendor/tts',
      voice: 'voice-id',
      language: 'ko',
    })
  })
  it('does not preflight request-scoped OIDC environment credentials', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '')
    vi.stubEnv('VERCEL_OIDC_TOKEN', '')
    expect(
      await collect(
        await handleSpeech(input, new AbortController().signal, { env: {} }),
      ),
    ).toHaveLength(2)
  })
  it('rejects invalid input/configuration before paid generation', async () => {
    await expect(
      handleSpeech({ ...input, text: ' ' }, new AbortController().signal, {
        env: {},
      }),
    ).rejects.toThrow()
    await expect(
      handleSpeech(input, new AbortController().signal, {
        env: { SPEECH_MODEL: 'private' },
      }),
    ).rejects.toThrow('Pronunciation is not configured correctly.')
    expect(sdk.generateSpeech).not.toHaveBeenCalled()
  })
  it('sanitizes generation failures without retrying or logging provider content', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    sdk.generateSpeech.mockRejectedValue(new Error('PRIVATE BODY and token'))
    await expect(
      collect(
        await handleSpeech(input, new AbortController().signal, { env: {} }),
      ),
    ).rejects.toThrow('Pronunciation failed. Please try again.')
    expect(sdk.generateSpeech).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })
  it('localizes generation errors', async () => {
    sdk.generateSpeech.mockRejectedValue(new Error('PRIVATE BODY'))
    await expect(
      collect(
        await handleSpeech(
          { ...input, uiLang: 'ko' },
          new AbortController().signal,
          { env: {} },
        ),
      ),
    ).rejects.toThrow('발음을 재생하지 못했어요. 다시 시도해 주세요.')
  })
  it.each([
    ['compressed data', () => wav(undefined, { format: 3 })],
    ['stereo', () => wav(undefined, { channels: 2 })],
    ['8-bit samples', () => wav(undefined, { bits: 8 })],
    ['zero rate', () => wav(undefined, { rate: 0 })],
    ['unsupported rate', () => wav(undefined, { rate: 96000 })],
    ['odd PCM data', () => wav(new Uint8Array([1]))],
    ['empty audio', () => wav(new Uint8Array())],
    ['truncated header', () => wav().slice(0, 20)],
    ['truncated audio', () => wav().slice(0, 46)],
    ['wrong container', () => new Uint8Array(48)],
    [
      'oversized response',
      () => wav(new Uint8Array(MAX_SPEECH_AUDIO_BYTES + 2)),
    ],
    [
      'invalid byte rate',
      () => {
        const b = wav()
        new DataView(b.buffer).setUint32(28, 1, true)
        return b
      },
    ],
  ])('rejects %s before scheduling audio', async (_name, makeAudio) => {
    sdk.generateSpeech.mockResolvedValue({ audio: { uint8Array: makeAudio() } })
    await expect(
      collect(
        await handleSpeech(input, new AbortController().signal, { env: {} }),
      ),
    ).rejects.toThrow('Pronunciation failed.')
  })
  it('honors the sample rate reported in a valid WAV', async () => {
    sdk.generateSpeech.mockResolvedValue({
      audio: { uint8Array: wav(undefined, { rate: 16000 }) },
    })
    const output = await collect(
      await handleSpeech(input, new AbortController().signal, { env: {} }),
    )
    expect(output[0]).toMatchObject({ sampleRate: 16000 })
  })
  it('does not synthesize a request that was already canceled', async () => {
    const request = new AbortController()
    request.abort()
    await expect(
      collect(await handleSpeech(input, request.signal, { env: {} })),
    ).rejects.toThrow()
    expect(sdk.generateSpeech).not.toHaveBeenCalled()
  })
  it('aborts paid generation when Stop cancels the consumer while connecting', async () => {
    const wait = deferred()
    sdk.generateSpeech.mockReturnValue(wait.promise)
    const stream = await handleSpeech(input, new AbortController().signal, {
      env: {},
    })
    await stream.cancel('private reason')
    const signal = sdk.generateSpeech.mock.calls[0]![0]
      .abortSignal as AbortSignal
    expect(signal.aborted).toBe(true)
    expect(signal.reason.message).not.toContain('private')
    wait.resolve({ audio: { uint8Array: wav() } })
    await Promise.resolve()
  })
  it('rejects a pending read on navigation abort even if generation ignores the signal', async () => {
    const request = new AbortController()
    const wait = deferred()
    sdk.generateSpeech.mockReturnValue(wait.promise)
    const stream = await handleSpeech(input, request.signal, { env: {} })
    const reader = stream.getReader()
    const pending = reader.read()
    request.abort(new Error('PRIVATE BODY'))
    await expect(pending).rejects.toThrow('Pronunciation failed.')
    wait.resolve({ audio: { uint8Array: wav() } })
    expect(await reader.read().catch(() => 'canceled')).toBe('canceled')
  })
  it('times out slow generation without waiting for the provider', async () => {
    vi.useFakeTimers()
    sdk.generateSpeech.mockReturnValue(new Promise(() => {}))
    const stream = await handleSpeech(input, new AbortController().signal, {
      env: {},
    })
    const pending = expect(stream.getReader().read()).rejects.toThrow(
      'Pronunciation failed.',
    )
    await vi.advanceTimersByTimeAsync(90001)
    await pending
    expect(sdk.generateSpeech.mock.calls[0]![0].abortSignal.aborted).toBe(true)
  })
  it('keeps warning content and speech events out of logs and registered SDK telemetry', async () => {
    const actual = await vi.importActual<typeof AiSdk>('ai')
    const emitted = vi
      .spyOn(process, 'emitWarning')
      .mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const events = vi.fn()
    const integration = { onStart: events, onEnd: events, onError: events }
    const previous = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS
    actual.registerTelemetry(integration)
    try {
      sdk.generateSpeech.mockImplementation(
        (options: Parameters<typeof AiSdk.generateSpeech>[0]) =>
          actual.generateSpeech({
            ...options,
            model: {
              specificationVersion: 'v4',
              provider: 'fixture',
              modelId: 'tts',
              async doGenerate() {
                return {
                  audio: wav(),
                  response: { timestamp: new Date(), modelId: 'tts' },
                  warnings: [{ type: 'other', message: 'PRIVATE BODY' }],
                }
              },
            },
          }),
      )
      const outputs = await Promise.all(
        [1, 2].map(async () =>
          collect(
            await handleSpeech(input, new AbortController().signal, {
              env: {},
            }),
          ),
        ),
      )
      expect(outputs.every((output) => output.length === 2)).toBe(true)
      expect(emitted).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
      expect(events).not.toHaveBeenCalled()
    } finally {
      globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = previous
    }
  })
})
