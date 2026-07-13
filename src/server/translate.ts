import { createServerFn } from '@tanstack/react-start'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { SentenceResult, WordResult } from './schemas'
import { sentencePrompt, wordPrompt } from './prompts'
import { translationCache } from './cache'
import { CACHE_VERSION, cacheKeyFor, promptCacheKeyFor } from './cacheKey'
import { calculateTokenCostUsd } from './pricing'
import { startTranslationTelemetry } from './telemetry'
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
})

export type Meta = {
  durationMs: number
  timeToFirstTokenMs?: number
  model: string
  tokens: {
    input: number
    cachedInput: number
    cacheWriteInput: number
    output: number
    total: number
  }
  costUsd?: number
}

export type TranslateDone =
  | { intent: 'sentence'; data: SentenceResult; meta: Meta }
  | { intent: 'word'; data: WordResult; meta: Meta }

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
    isPolish: data.source === data.target,
    promptVersion: CACHE_VERSION,
  }
}

// Lazy so the OpenAI client (and its OPENAI_API_KEY check) only exists server-side.
let _client: OpenAI | undefined
const client = () => (_client ??= new OpenAI())

function priceFor(tokens: {
  input: number
  cachedInput: number
  cacheWriteInput: number
  output: number
}) {
  const inPer1M = Number(process.env.TRANSLATE_PRICE_INPUT_PER_1M)
  const cachedInPer1M = Number(process.env.TRANSLATE_PRICE_CACHED_INPUT_PER_1M)
  const cacheWriteInPer1M = Number(
    process.env.TRANSLATE_PRICE_CACHE_WRITE_INPUT_PER_1M,
  )
  const outPer1M = Number(process.env.TRANSLATE_PRICE_OUTPUT_PER_1M)
  if (!Number.isFinite(inPer1M) || !Number.isFinite(outPer1M)) return undefined

  // Preserve the old all-input-at-base-rate estimate when detailed cache
  // prices are not configured (for example, an older deployment environment).
  if (!Number.isFinite(cachedInPer1M) || !Number.isFinite(cacheWriteInPer1M)) {
    return (tokens.input * inPer1M + tokens.output * outPer1M) / 1_000_000
  }

  return calculateTokenCostUsd(tokens, {
    inputPer1M: inPer1M,
    cachedInputPer1M: cachedInPer1M,
    cacheWriteInputPer1M: cacheWriteInPer1M,
    outputPer1M: outPer1M,
  })
}

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
      telemetry.succeed()
      const done: TranslateDone = {
        ...cached,
        meta: { ...cached.meta, durationMs: 0 },
      }
      return new ReadableStream<TranslateChunk>({
        start(controller) {
          controller.enqueue({ type: 'cache', done })
          controller.close()
        },
      })
    }

    const isWord = data.intent === 'word'
    const telemetry = await startTranslationTelemetry(
      dimensions,
      'openai',
      MODEL,
    )
    const t0 = Date.now()
    let firstTokenAt: number | undefined

    return new ReadableStream<TranslateChunk>({
      async start(controller) {
        try {
          const stream = client().responses.stream({
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
          })

          // Forward each JSON fragment as-is; the client accumulates and
          // renders via partial-json. Sending only the delta keeps the stream
          // payload linear instead of quadratic in response length.
          for await (const event of stream) {
            if (event.type === 'response.output_text.delta') {
              if (firstTokenAt === undefined) {
                firstTokenAt = Date.now()
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

          const meta: Meta = {
            durationMs: Date.now() - t0,
            ...(firstTokenAt === undefined
              ? {}
              : { timeToFirstTokenMs: firstTokenAt - t0 }),
            model: MODEL,
            tokens: {
              input: inputTokens,
              cachedInput,
              cacheWriteInput,
              output: outputTokens,
              total: response.usage?.total_tokens ?? 0,
            },
            costUsd: priceFor({
              input: inputTokens,
              cachedInput,
              cacheWriteInput,
              output: outputTokens,
            }),
          }

          const done: TranslateDone = isWord
            ? { intent: 'word', data: parsed as WordResult, meta }
            : { intent: 'sentence', data: parsed as SentenceResult, meta }

          telemetry.succeed({ tokens: meta.tokens, costUsd: meta.costUsd })
          translationCache.set(cacheKey, done)
          controller.enqueue({ type: 'done', done })
          controller.close()
        } catch (err) {
          telemetry.fail(err)
          controller.error(err)
        }
      },
    })
  })
