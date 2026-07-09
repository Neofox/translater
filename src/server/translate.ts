import { createServerFn } from '@tanstack/react-start'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { SentenceResult, WordResult } from './schemas'
import { sentencePrompt, wordPrompt } from './prompts'
import { translationCache } from './cache'
import { cacheKeyFor } from './cacheKey'
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
  model: string
  tokens: { input: number; output: number; total: number }
  costUsd?: number
}

export type TranslateDone =
  | { intent: 'sentence'; data: SentenceResult; meta: Meta }
  | { intent: 'word'; data: WordResult; meta: Meta }

export type TranslateChunk =
  | { type: 'delta'; raw: string } // incremental JSON fragment — client accumulates
  | { type: 'cache'; done: TranslateDone } // cache hit — single terminal chunk
  | { type: 'done'; done: TranslateDone } // stream terminal chunk

const MODEL = process.env.TRANSLATE_MODEL ?? 'gpt-5.4-mini'

// Word lookups want determinism; sentence temperature loosens with the mode.
// const SENTENCE_TEMPERATURE = { friends: 0.85, casual: 0.7, professional: 0.3 }
// const WORD_TEMPERATURE = 0.2

// Lazy so the OpenAI client (and its OPENAI_API_KEY check) only exists server-side.
let _client: OpenAI | undefined
const client = () => (_client ??= new OpenAI())

function priceFor(tokens: { input: number; output: number }) {
  const inPer1M = Number(process.env.TRANSLATE_PRICE_INPUT_PER_1M)
  const outPer1M = Number(process.env.TRANSLATE_PRICE_OUTPUT_PER_1M)
  if (!Number.isFinite(inPer1M) || !Number.isFinite(outPer1M)) return undefined
  return (tokens.input * inPer1M + tokens.output * outPer1M) / 1_000_000
}

export const translate = createServerFn({ method: 'POST' })
  .validator(TranslateInput)
  .handler(async ({ data }): Promise<ReadableStream<TranslateChunk>> => {
    const cacheKey = cacheKeyFor(data)

    const cached = translationCache.get(cacheKey) as TranslateDone | undefined
    if (cached) {
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
    const t0 = Date.now()

    return new ReadableStream<TranslateChunk>({
      async start(controller) {
        try {
          const stream = client().responses.stream({
            model: MODEL,
            input: isWord ? wordPrompt(data) : sentencePrompt(data),
            // temperature: isWord
            //   ? WORD_TEMPERATURE
            //   : SENTENCE_TEMPERATURE[data.mode],
            // Hidden reasoning tokens delay the first output delta by seconds;
            // translation quality here comes from the prompt, not deliberation.
            reasoning: { effort: 'none' },
            // Everything except the final user message is a stable prefix per
            // prompt shape — route same-shape requests to the same prefix cache.
            prompt_cache_key: `nt:${data.intent}:${data.uiLang}:${data.mode}:${
              data.source === data.target ? 'polish' : 'translate'
            }`,
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
              controller.enqueue({ type: 'delta', raw: event.delta })
            }
          }

          // zodTextFormat already ran the Zod parse on the final output.
          const response = await stream.finalResponse()
          const parsed = response.output_parsed
          if (!parsed) throw new Error('Model returned no structured output')

          const meta: Meta = {
            durationMs: Date.now() - t0,
            model: MODEL,
            tokens: {
              input: response.usage?.input_tokens ?? 0,
              output: response.usage?.output_tokens ?? 0,
              total: response.usage?.total_tokens ?? 0,
            },
            costUsd: priceFor({
              input: response.usage?.input_tokens ?? 0,
              output: response.usage?.output_tokens ?? 0,
            }),
          }

          const done: TranslateDone = isWord
            ? { intent: 'word', data: parsed as WordResult, meta }
            : { intent: 'sentence', data: parsed as SentenceResult, meta }

          translationCache.set(cacheKey, done)
          controller.enqueue({ type: 'done', done })
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })
  })
