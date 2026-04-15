import { createServerFn } from '@tanstack/react-start'
import OpenAI from 'openai'
import { z } from 'zod'
import { PROVIDER } from './llm'
import { SentenceResult, WordResult } from './schemas'
import { sentencePrompt, wordPrompt } from './prompts'
import { translationCache } from './cache'

const TranslateInput = z.object({
  text: z.string().min(1).max(4000),
  source: z.string(),
  target: z.string(),
  mode: z.enum(['friends', 'casual', 'professional']),
  intent: z.enum(['word', 'sentence']),
  uiLang: z.enum(['en', 'ko']).default('en'),
})

export type Meta = {
  durationMs: number
  provider: 'openai' | 'openrouter' | 'lmstudio'
  model: string
  tokens: { input: number; output: number; total: number }
  costUsd?: number
}

export type TranslateDone =
  | { intent: 'sentence'; data: z.infer<typeof SentenceResult>; meta: Meta }
  | { intent: 'word'; data: z.infer<typeof WordResult>; meta: Meta }

export type TranslateChunk =
  | { type: 'delta'; raw: string } // progressive JSON text
  | { type: 'cache'; done: TranslateDone } // cache hit — single terminal chunk
  | { type: 'done'; done: TranslateDone } // stream terminal chunk

const client = new OpenAI({
  apiKey: PROVIDER.apiKey,
  baseURL: PROVIDER.baseURL,
  defaultHeaders:
    'extraHeaders' in PROVIDER ? PROVIDER.extraHeaders : undefined,
})

function schemaFor(intent: 'word' | 'sentence') {
  const schema = intent === 'word' ? WordResult : SentenceResult
  return z.toJSONSchema(schema, { target: 'draft-7' })
}

function priceFor(tokens: { input: number; output: number }) {
  const inPer1M = Number(process.env.TRANSLATE_PRICE_INPUT_PER_1M)
  const outPer1M = Number(process.env.TRANSLATE_PRICE_OUTPUT_PER_1M)
  if (!Number.isFinite(inPer1M) || !Number.isFinite(outPer1M)) return undefined
  return (tokens.input * inPer1M + tokens.output * outPer1M) / 1_000_000
}

export const translate = createServerFn({ method: 'POST' })
  .inputValidator(TranslateInput)
  .handler(async ({ data }): Promise<ReadableStream<TranslateChunk>> => {
    // Bump when the response schema or prompt changes so stale entries miss.
    const CACHE_VERSION = 'v4-uiLang'
    const cacheKey = JSON.stringify([
      CACHE_VERSION,
      data.intent,
      data.mode,
      data.source,
      data.target,
      data.uiLang,
      data.text.trim(),
    ])

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

    const messages =
      data.intent === 'word' ? wordPrompt(data) : sentencePrompt(data)

    const jsonSchema = schemaFor(data.intent)
    const t0 = Date.now()

    return new ReadableStream<TranslateChunk>({
      async start(controller) {
        try {
          const stream = await client.responses.create({
            model: PROVIDER.model,
            input: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature:
              data.intent === 'word'
                ? 0.2
                : data.mode === 'friends'
                  ? 0.85
                  : data.mode === 'casual'
                    ? 0.7
                    : 0.3,
            text: {
              format: {
                type: 'json_schema',
                name: 'translation_output',
                schema: jsonSchema as Record<string, unknown>,
                strict: false,
              },
            },
            stream: true,
          })

          let accumulated = ''
          let usage: { input: number; output: number; total: number } = {
            input: 0,
            output: 0,
            total: 0,
          }

          for await (const event of stream) {
            // Forward partial text deltas to the client.
            if (event.type === 'response.output_text.delta') {
              const delta = (event as { delta?: string }).delta ?? ''
              accumulated += delta
              controller.enqueue({ type: 'delta', raw: accumulated })
            } else if (event.type === 'response.completed') {
              const resp = (event as { response?: OpenAI.Responses.Response })
                .response
              if (resp?.usage) {
                usage = {
                  input: resp.usage.input_tokens,
                  output: resp.usage.output_tokens,
                  total: resp.usage.total_tokens,
                }
              }
            }
          }

          const parsed = JSON.parse(accumulated)
          const validated =
            data.intent === 'word'
              ? WordResult.parse(parsed)
              : SentenceResult.parse(parsed)

          const meta: Meta = {
            durationMs: Date.now() - t0,
            provider: PROVIDER.name,
            model: PROVIDER.model,
            tokens: usage,
            costUsd: priceFor(usage),
          }

          const done: TranslateDone =
            data.intent === 'word'
              ? {
                  intent: 'word',
                  data: validated as z.infer<typeof WordResult>,
                  meta,
                }
              : {
                  intent: 'sentence',
                  data: validated as z.infer<typeof SentenceResult>,
                  meta,
                }

          translationCache.set(cacheKey, done)
          controller.enqueue({ type: 'done', done })
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })
  })
