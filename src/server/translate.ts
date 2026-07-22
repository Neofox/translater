import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Output, streamText } from 'ai'
import { translationCache } from './cache'
import { CACHE_VERSION, cacheKeyFor, promptCacheKeyFor } from './cacheKey'
import {
  assertGatewayApiKey,
  gatewayProviderOptions,
  gatewayTags,
  resolveTranslateModel,
} from './gateway'
import { sentencePrompt, wordPrompt } from './prompts'
import { SentenceResult, WordResult } from './schemas'
import { consumeStructuredStream } from './structuredStream'
import {
  prepareTranslationTelemetry,
  translationRuntimeContext,
  translationTelemetryOptions,
} from './telemetry'
import {
  classifyTranslationError,
  isTranslationAbort,
  publicTranslationError,
} from './translationError'
import { TranslateInput } from './translateTypes'
import type { TranslateInputData } from './translateTypes'

export { TranslateInput } from './translateTypes'
export type { TranslateInputData } from './translateTypes'

export type TranslateDone =
  | { intent: 'sentence'; data: SentenceResult }
  | { intent: 'word'; data: WordResult }

export type TranslateChunk =
  | { type: 'delta'; raw: string }
  | { type: 'cache'; done: TranslateDone }
  | { type: 'done'; done: TranslateDone }

type TranslationCache = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}

type TranslationDependencies = {
  streamText: typeof streamText
  cache: TranslationCache
  prepareTelemetry: typeof prepareTranslationTelemetry
}

const MODEL = resolveTranslateModel()

const defaultDependencies: TranslationDependencies = {
  streamText,
  cache: translationCache,
  prepareTelemetry: prepareTranslationTelemetry,
}

export async function handleTranslate(
  data: TranslateInputData,
  requestSignal: AbortSignal,
  dependencies: Partial<TranslationDependencies> = {},
): Promise<ReadableStream<TranslateChunk>> {
  const runtime = { ...defaultDependencies, ...dependencies }
  const cacheKey = cacheKeyFor(data, MODEL)
  const cached = runtime.cache.get(cacheKey) as TranslateDone | undefined

  if (cached) {
    return new ReadableStream<TranslateChunk>({
      start(controller) {
        controller.enqueue({ type: 'cache', done: cached })
        controller.close()
      },
    })
  }

  assertGatewayApiKey()
  const nativeTelemetry = await runtime.prepareTelemetry()

  const isWord = data.intent === 'word'
  const requestKind =
    data.refinements.length > 0
      ? ('refinement' as const)
      : data.context
        ? ('context' as const)
        : ('initial' as const)
  const prompt = isWord ? wordPrompt(data) : sentencePrompt(data)
  const structuredOutput = isWord
    ? Output.object({ schema: WordResult, name: 'word_translation' })
    : Output.object({ schema: SentenceResult, name: 'sentence_translation' })

  return new ReadableStream<TranslateChunk>({
    async start(controller) {
      try {
        const result = runtime.streamText({
          model: MODEL,
          instructions: prompt.instructions,
          messages: prompt.messages,
          output: structuredOutput,
          abortSignal: requestSignal,
          maxRetries: 0,
          providerOptions: gatewayProviderOptions({
            model: MODEL,
            promptCacheKey: promptCacheKeyFor(data),
            tags: gatewayTags({
              intent: data.intent,
              requestKind,
              promptVersion: CACHE_VERSION,
            }),
          }),
          runtimeContext: translationRuntimeContext(data, MODEL, CACHE_VERSION),
          telemetry: translationTelemetryOptions(nativeTelemetry.enabled),
        })

        const parsed = await consumeStructuredStream({
          textStream: result.textStream,
          output: result.output,
          onFirstToken() {},
          onDelta(raw) {
            controller.enqueue({ type: 'delta', raw })
          },
        })

        const done: TranslateDone = isWord
          ? { intent: 'word', data: parsed as unknown as WordResult }
          : { intent: 'sentence', data: parsed as unknown as SentenceResult }

        runtime.cache.set(cacheKey, done)
        controller.enqueue({ type: 'done', done })
        controller.close()
      } catch (error) {
        if (isTranslationAbort(error, requestSignal)) {
          try {
            controller.close()
          } catch {
            // The browser may already have canceled its reader.
          }
        } else {
          controller.error(
            publicTranslationError(
              classifyTranslationError(error),
              data.uiLang,
            ),
          )
        }
      } finally {
        await nativeTelemetry.flush()
      }
    },
  })
}

export const translate = createServerFn({ method: 'POST' })
  .validator(TranslateInput)
  .handler(async ({ data }): Promise<ReadableStream<TranslateChunk>> => {
    return handleTranslate(data, getRequest().signal)
  })
