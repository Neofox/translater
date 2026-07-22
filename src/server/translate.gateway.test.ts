import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleTranslate, type TranslateChunk } from './translate'

const validSentenceResult = {
  sourceLang: 'en' as const,
  targetLang: 'ko' as const,
  main: '안녕하세요',
  rationale: 'A natural greeting.',
  alternatives: [],
  formalityNote: '',
  learningTips: { grammar: '', vocab: '', characters: [] },
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

describe('handleTranslate via AI Gateway', () => {
  beforeEach(() => vi.stubEnv('AI_GATEWAY_API_KEY', 'test-gateway-key'))
  afterEach(() => vi.unstubAllEnvs())

  it('sends one exact-model structured request and preserves raw deltas', async () => {
    const streamText = vi.fn((_request: Record<string, unknown>) => ({
      textStream: deltas(),
      output: Promise.resolve(validSentenceResult),
    }))
    const cache = cacheDouble()
    const requestSignal = new AbortController().signal

    const stream = await handleTranslate(data, requestSignal, {
      streamText: streamText as never,
      cache,
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
        model: 'openai/gpt-5.6-luna',
        maxRetries: 0,
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
        providerOptions: {
          gateway: {
            caching: 'auto',
            tags: [
              'translation',
              'sentence',
              'initial',
              'v12-ai-gateway',
            ],
          },
          openai: {
            reasoningEffort: 'none',
            store: false,
            promptCacheKey: expect.stringContaining('nt:v12-ai-gateway'),
          },
        },
      }),
    )
    expect(streamText).toHaveBeenCalledTimes(1)
    const sdkRequest = streamText.mock.calls[0]![0] as {
      providerOptions: { gateway: Record<string, unknown> }
    }
    expect(sdkRequest.providerOptions.gateway).not.toHaveProperty('models')
    expect(sdkRequest).not.toHaveProperty('allowSystemInMessages')
    expect(cache.set).toHaveBeenCalledTimes(1)
  })

  it('does not cache or emit a terminal result when validation rejects', async () => {
    const validationError = new Error('invalid structured output')
    const streamText = vi.fn((_request: Record<string, unknown>) => ({
      textStream: deltas(),
      output: Promise.reject(validationError),
    }))
    const cache = cacheDouble()
    const stream = await handleTranslate(
      data,
      new AbortController().signal,
      { streamText: streamText as never, cache },
    )

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
              new DOMException('private provider cancellation body', 'AbortError'),
            )
          })
        })
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
