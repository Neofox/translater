import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { SentenceResult, WordResult } from './schemas'
import { sentencePrompt, wordPrompt } from './prompts'
import { translationCache } from './cache'
import { CACHE_VERSION, cacheKeyFor, promptCacheKeyFor } from './cacheKey'
import { configuredTokenCostDetailsUsd } from './pricing'
import { characterCountBucket, startTranslationTelemetry } from './telemetry'
import {
  MAX_CONTEXT_CHARS,
  MAX_INPUT_CHARS,
  MAX_REFINEMENT_CHARS,
  MAX_REFINEMENTS,
} from '../lib/limits'

const TranslateInput = z.object({
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

export type TranslateDone =
  | { intent: 'sentence'; data: SentenceResult }
  | { intent: 'word'; data: WordResult }

export type TranslateChunk =
  | { type: 'delta'; raw: string } // incremental JSON fragment — client accumulates
  | { type: 'cache'; done: TranslateDone } // cache hit — single terminal chunk
  | { type: 'done'; done: TranslateDone } // stream terminal chunk

const MODEL = process.env.TRANSLATE_MODEL ?? 'gpt-5.6-luna'

function telemetryDimensions(data: z.infer<typeof TranslateInput>) {
  return {
    intent: data.intent,
    mode: data.mode,
    sourceLanguage: data.source,
    targetLanguage: data.target,
    uiLanguage: data.uiLang,
    hasContext: Boolean(data.context),
    refinementCount: data.refinements.length,
    requestKind:
      data.refinements.length > 0
        ? ('refinement' as const)
        : data.context
          ? ('context' as const)
          : ('initial' as const),
    inputLengthBucket: characterCountBucket(data.text.length),
    isPolish: data.source === data.target,
    promptVersion: CACHE_VERSION,
    ...(data.analyticsSessionId
      ? { analyticsSessionId: data.analyticsSessionId }
      : {}),
    ...(data.analyticsRunId ? { clientRunId: data.analyticsRunId } : {}),
    ...(data.analyticsSupersedesRunId
      ? { supersedesRunId: data.analyticsSupersedesRunId }
      : {}),
    ...(data.analyticsInputRevision !== undefined
      ? { inputRevision: data.analyticsInputRevision }
      : {}),
    trigger: data.analyticsTrigger,
  }
}

function resultAnalytics(result: SentenceResult | WordResult) {
  const output = 'main' in result ? result.main : result.primaryTranslation
  const alternatives =
    'alternatives' in result
      ? result.alternatives
      : result.alternativeTranslations
  const tips = result.learningTips

  return {
    resolvedSourceLanguage: result.sourceLang,
    resolvedTargetLanguage: result.targetLang,
    outputLengthBucket: characterCountBucket(output.length),
    alternativeCount: alternatives.length,
    hasLearningTips: Boolean(
      tips.grammar || tips.vocab || tips.characters.length > 0,
    ),
  }
}

// Lazy so the OpenAI client (and its OPENAI_API_KEY check) only exists server-side.
let _client: OpenAI | undefined
const client = () => (_client ??= new OpenAI())

export const translate = createServerFn({ method: 'POST' })
  .validator(TranslateInput)
  .handler(async ({ data }): Promise<ReadableStream<TranslateChunk>> => {
    const cacheKey = cacheKeyFor(data)
    const dimensions = telemetryDimensions(data)

    const cached = translationCache.get(cacheKey) as TranslateDone | undefined
    if (cached) {
      const telemetry = await startTranslationTelemetry(
        dimensions,
        'local',
        MODEL,
      )
      telemetry.succeed(resultAnalytics(cached.data))
      return new ReadableStream<TranslateChunk>({
        async start(controller) {
          controller.enqueue({ type: 'cache', done: cached })
          controller.close()
          await telemetry.flush()
        },
      })
    }

    const isWord = data.intent === 'word'
    const telemetry = await startTranslationTelemetry(
      dimensions,
      'openai',
      MODEL,
    )
    const requestSignal = getRequest().signal
    let sawFirstToken = false

    return new ReadableStream<TranslateChunk>({
      async start(controller) {
        try {
          const stream = client().responses.stream(
            {
              model: MODEL,
              input: isWord ? wordPrompt(data) : sentencePrompt(data),
              // Hidden reasoning tokens delay the first output delta by seconds;
              // translation quality here comes from the prompt, not deliberation.
              reasoning: { effort: 'none' },
              store: false,
              // The explicit breakpoint follows a stable reminder in the final
              // user message; live source/context/refinements come after it.
              prompt_cache_key: promptCacheKeyFor(data),
              prompt_cache_options: { mode: 'explicit', ttl: '30m' },
              text: {
                format: isWord
                  ? zodTextFormat(WordResult, 'word_translation')
                  : zodTextFormat(SentenceResult, 'sentence_translation'),
              },
            },
            { signal: requestSignal },
          )

          // Forward each JSON fragment as-is; the client accumulates and
          // renders via partial-json. Sending only the delta keeps the stream
          // payload linear instead of quadratic in response length.
          for await (const event of stream) {
            if (event.type === 'response.output_text.delta') {
              if (!sawFirstToken) {
                sawFirstToken = true
                telemetry.markFirstToken()
              }
              controller.enqueue({ type: 'delta', raw: event.delta })
            }
          }

          // zodTextFormat already ran the Zod parse on the final output.
          const response = await stream.finalResponse()
          const parsed = response.output_parsed
          if (!parsed) throw new Error('Model returned no structured output')

          const inputTokens = response.usage?.input_tokens ?? 0
          const cachedInput =
            response.usage?.input_tokens_details.cached_tokens ?? 0
          const cacheWriteInput =
            response.usage?.input_tokens_details.cache_write_tokens ?? 0
          const outputTokens = response.usage?.output_tokens ?? 0

          const tokens = {
            input: inputTokens,
            cachedInput,
            cacheWriteInput,
            output: outputTokens,
            total: response.usage?.total_tokens ?? 0,
          }

          const done: TranslateDone = isWord
            ? { intent: 'word', data: parsed as WordResult }
            : { intent: 'sentence', data: parsed as SentenceResult }

          telemetry.succeed({
            ...resultAnalytics(done.data),
            tokens,
            costDetails: configuredTokenCostDetailsUsd(tokens),
          })
          translationCache.set(cacheKey, done)
          controller.enqueue({ type: 'done', done })
          controller.close()
        } catch (err) {
          if (
            requestSignal.aborted ||
            err instanceof OpenAI.APIUserAbortError ||
            (err instanceof Error && err.name === 'AbortError')
          ) {
            telemetry.cancel()
          } else {
            telemetry.fail(err)
          }
          controller.error(err)
        } finally {
          await telemetry.flush()
        }
      },
    })
  })
