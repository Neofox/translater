import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CACHE_VERSION } from './cacheKey'
import { SAFE_TRANSLATION_CONTEXT_KEYS } from './telemetry'
import { handleTranslate } from './translate'
import type { TranslateChunk } from './translate'

const validSentenceResult = {
  sourceLang: 'en' as const,
  targetLang: 'ko' as const,
  main: '안녕하세요',
  learningPhrases: [
    {
      text: '안녕하세요',
      gloss: 'hello',
      sourceTexts: ['hello'],
      baseForm: '안녕하다',
      literalMeaning: 'be at peace',
      naturalMeaning: 'hello',
      grammar: 'A polite greeting.',
      omissions: '',
      grammarHighlights: [],
      usageNote: '',
      characters: [],
    },
  ],
  rationale: 'A natural greeting.',
  alternatives: [],
  formalityNote: '',
}

const data = {
  text: 'hello',
  source: 'en',
  target: 'ko',
  mode: 'casual' as const,
  intent: 'sentence' as const,
  uiLang: 'en' as const,
  context: '',
  refinements: [],
  previousMain: '',
  analyticsTrigger: 'enter' as const,
}

async function* deltas() {
  yield '{"main":"안녕'
  yield '하세요"}'
}

async function readChunks(
  stream: ReadableStream<TranslateChunk>,
): Promise<TranslateChunk[]> {
  const chunks: TranslateChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function cacheDouble() {
  return {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  }
}

describe('handleTranslate via OpenAI', () => {
  beforeEach(() => vi.stubEnv('OPENAI_API_KEY', 'test-openai-key'))
  afterEach(() => vi.unstubAllEnvs())

  it('sends one exact-model structured request and preserves raw deltas', async () => {
    const streamText = vi.fn((_request: Record<string, unknown>) => ({
      textStream: deltas(),
      output: Promise.resolve(validSentenceResult),
    }))
    const cache = cacheDouble()
    const requestSignal = new AbortController().signal
    const flush = vi.fn().mockResolvedValue(undefined)
    const prepareTelemetry = vi.fn().mockResolvedValue({
      enabled: true,
      flush,
    })

    const stream = await handleTranslate(data, requestSignal, {
      streamText: streamText as never,
      cache,
      prepareTelemetry,
    })

    await expect(readChunks(stream)).resolves.toEqual([
      { type: 'delta', raw: '{"main":"안녕' },
      { type: 'delta', raw: '하세요"}' },
      {
        type: 'done',
        done: { intent: 'sentence', data: validSentenceResult },
      },
    ])

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: 'openai.responses',
          modelId: 'gpt-6.1-terra',
        }),
        maxRetries: 0,
        reasoning: 'none',
        abortSignal: requestSignal,
        instructions: [
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'system' }),
        ],
        messages: [
          expect.objectContaining({ role: 'user' }),
          expect.objectContaining({ role: 'assistant' }),
          expect.objectContaining({ role: 'user' }),
        ],
        output: expect.anything(),
        runtimeContext: expect.objectContaining({
          intent: 'sentence',
          requestedModel: 'gpt-6.1-terra',
          reasoningEffort: 'none',
          serviceTier: 'fast',
        }),
        telemetry: {
          isEnabled: true,
          recordInputs: false,
          recordOutputs: false,
          functionId: 'translation',
          includeRuntimeContext: SAFE_TRANSLATION_CONTEXT_KEYS,
        },
        providerOptions: {
          openai: {
            reasoningEffort: 'none',
            serviceTier: 'fast',
            store: false,
            promptCacheKey: expect.stringContaining(`nt:${CACHE_VERSION}`),
            promptCacheOptions: {
              mode: 'explicit',
              ttl: '30m',
            },
          },
        },
      }),
    )
    expect(streamText).toHaveBeenCalledTimes(1)
    const sdkRequest = streamText.mock.calls[0]![0] as {
      providerOptions: Record<string, unknown>
    }
    expect(Object.keys(sdkRequest.providerOptions)).toEqual(['openai'])
    expect(sdkRequest).not.toHaveProperty('allowSystemInMessages')
    expect(sdkRequest).not.toHaveProperty('include')
    expect(sdkRequest).not.toHaveProperty('metadata')
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('returns local cache hits without initializing native telemetry', async () => {
    const cached = {
      intent: 'sentence' as const,
      data: validSentenceResult,
    }
    const cache = {
      get: vi.fn(() => cached),
      set: vi.fn(),
    }
    const streamText = vi.fn()
    const prepareTelemetry = vi.fn()
    const stream = await handleTranslate(data, new AbortController().signal, {
      streamText: streamText as never,
      cache,
      prepareTelemetry,
    })

    await expect(readChunks(stream)).resolves.toEqual([
      { type: 'cache', done: cached },
    ])
    expect(streamText).not.toHaveBeenCalled()
    expect(prepareTelemetry).not.toHaveBeenCalled()
  })

  it('does not cache or emit a terminal result when validation rejects', async () => {
    const validationError = new Error('invalid structured output')
    const streamText = vi.fn((_request: Record<string, unknown>) => ({
      textStream: deltas(),
      output: Promise.reject(validationError),
    }))
    const cache = cacheDouble()
    const stream = await handleTranslate(data, new AbortController().signal, {
      streamText: streamText as never,
      cache,
    })

    await expect(readChunks(stream)).rejects.toThrow('Translation failed.')
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('closes cancellation without exposing provider details or caching', async () => {
    const controller = new AbortController()
    const cache = cacheDouble()
    const streamText = vi.fn((request: { abortSignal: AbortSignal }) => ({
      textStream: (async function* () {
        await new Promise<void>((_resolve, reject) => {
          request.abortSignal.addEventListener('abort', () => {
            reject(
              new DOMException(
                'private provider cancellation body',
                'AbortError',
              ),
            )
          })
        })
        yield ''
      })(),
      output: Promise.resolve(validSentenceResult),
    }))
    const stream = await handleTranslate(data, controller.signal, {
      streamText: streamText as never,
      cache,
    })

    controller.abort()
    await expect(readChunks(stream)).resolves.toEqual([])
    expect(streamText.mock.calls[0]![0].abortSignal).toBe(controller.signal)
    expect(cache.set).not.toHaveBeenCalled()
  })
})
