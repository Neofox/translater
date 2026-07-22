import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Output, streamText } from 'ai'
import { z } from 'zod'
import {
  MAX_CONTEXT_CHARS,
  MAX_INPUT_CHARS,
  MAX_REFINEMENT_CHARS,
  MAX_REFINEMENTS,
} from '../lib/limits'
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
  classifyTranslationError,
  isTranslationAbort,
  publicTranslationError,
} from './translationError'

export const TranslateInput = z.object({
  text: z.string().min(1).max(MAX_INPUT_CHARS),
  source: z.string(),
  target: z.string(),
  mode: z.enum(['friends', 'casual', 'professional']),
  intent: z.enum(['word', 'sentence']),
  uiLang: z.enum(['en', 'ko']).default('en'),
  context: z.string().max(MAX_CONTEXT_CHARS).default(''),
  refinements: z
    .array(z.string().min(1).max(MAX_REFINEMENT_CHARS))
    .max(MAX_REFINEMENTS)
    .default([]),
  previousMain: z.string().max(MAX_INPUT_CHARS).default(''),
  analyticsSessionId: z.uuid().optional(),
  analyticsRunId: z.uuid().optional(),
  analyticsSupersedesRunId: z.uuid().optional(),
  analyticsInputRevision: z.number().int().nonnegative().optional(),
  analyticsTrigger: z
    .enum(['debounce', 'paste', 'enter', 'blur', 'force', 'refinement'])
    .default('debounce'),
})

export type TranslateInputData = z.infer<typeof TranslateInput>

export type TranslateDone =
  | { intent: 'sentence'; data: SentenceResult }
  | { intent: 'word'; data: WordResult }

export type TranslateChunk =
  | { type: 'delta'; raw: string }
  | { type: 'cache'; done: TranslateDone }
  | { type: 'done'; done: TranslateDone }

type TranslationCache = {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

type TranslationDependencies = {
  streamText: typeof streamText
  cache: TranslationCache
}

const MODEL = resolveTranslateModel()

const defaultDependencies: TranslationDependencies = {
  streamText,
  cache: translationCache,
}

export async function handleTranslate(
  data: TranslateInputData,
  requestSignal: AbortSignal,
  dependencies: TranslationDependencies = defaultDependencies,
): Promise<ReadableStream<TranslateChunk>> {
  const cacheKey = cacheKeyFor(data, MODEL)
  const cached = dependencies.cache.get(cacheKey) as TranslateDone | undefined

  if (cached) {
    return new ReadableStream<TranslateChunk>({
      start(controller) {
        controller.enqueue({ type: 'cache', done: cached })
        controller.close()
      },
    })
  }

  assertGatewayApiKey()

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
        const result = dependencies.streamText({
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

        dependencies.cache.set(cacheKey, done)
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
      }
    },
  })
}

export const translate = createServerFn({ method: 'POST' })
  .validator(TranslateInput)
  .handler(async ({ data }): Promise<ReadableStream<TranslateChunk>> => {
    return handleTranslate(data, getRequest().signal)
  })
