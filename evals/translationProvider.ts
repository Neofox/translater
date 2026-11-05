import './http.ts'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import promptfoo from 'promptfoo'
import { requestBody, requestBodySync } from './goRequest.ts'
import type { PromptVariant, TranslateInput } from './goRequest.ts'
import { estimateCost } from './pricing.ts'
import type { ServiceTier } from './pricing.ts'
import { validateResult } from './results.ts'

type Config = {
  model: string
  reasoning?: string
  serviceTier?: string
  promptVariant?: PromptVariant
}

type TranslateConfig = {
  model: string
  reasoning: string
  serviceTier: ServiceTier
}

type CallContext = {
  vars: Record<string, unknown>
  repeatIndex?: number
  bustCache?: boolean
}

// The request body cmd/request prints (the fields read here).
type InputText = { type: 'input_text'; text: string }
type RequestBody = {
  model: string
  input: [
    { role: 'developer'; content: string },
    { role: 'developer'; content: string },
    { role: 'user'; content: [InputText] },
    { role: 'assistant'; content: string },
    { role: 'user'; content: [InputText, InputText] },
  ]
  text: { format: { schema: Record<string, unknown> } }
  service_tier: ServiceTier
  prompt_cache_key: string
  reasoning: { effort: string }
}

// OpenAI Responses usage, as response.completed reports it.
type Usage = {
  input_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens?: number
  output_tokens_details?: { reasoning_tokens?: number }
  total_tokens?: number
}

// One file per translation. promptfoo's own cache is a single JSON file, and
// this module gets a separate cache instance from the CLI's: whichever saved
// last overwrote the other's entries, so almost no translations survived a
// run that also cached judge results.
const CACHE_DIR = join(
  process.env.PROMPTFOO_CACHE_PATH ?? '.promptfoo-cache',
  'translations',
)

async function readCached(key: string): Promise<object | undefined> {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, `${key}.json`), 'utf8'))
  } catch {
    return undefined
  }
}

async function writeCached(key: string, value: object) {
  await mkdir(CACHE_DIR, { recursive: true })
  const file = join(CACHE_DIR, `${key}.json`)
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(value))
  await rename(temp, file)
}

// The cache key hashes everything model-facing: prompt, schema, model,
// reasoning, tier and repeat index, so prompt edits never reuse stale
// outputs. Its shape is the one the earlier TypeScript provider hashed (the
// AI SDK call:
// instructions, messages and OpenAI provider options, and the schema as
// zod's toJSONSchema rendered it, which differs from the file only in
// $schema), rebuilt from the Go body so earlier cached translations still
// hit. Change the shape only together with clearing the cache.
export function cacheKey(body: RequestBody, repeatIndex: number): string {
  const [rule, system, fewshotUser, fewshotAssistant, final] = body.input
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider: 'openai',
        model: body.model,
        instructions: [
          { role: 'system', content: rule.content },
          { role: 'system', content: system.content },
        ],
        messages: [
          { role: 'user', content: fewshotUser.content[0].text },
          { role: 'assistant', content: fewshotAssistant.content },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: final.content[0].text,
                providerOptions: {
                  openai: { promptCacheBreakpoint: { mode: 'explicit' } },
                },
              },
              { type: 'text', text: final.content[1].text },
            ],
          },
        ],
        providerOptions: {
          openai: {
            reasoningEffort: body.reasoning.effort,
            serviceTier: body.service_tier,
            store: false,
            promptCacheKey: body.prompt_cache_key,
            promptCacheOptions: { mode: 'explicit', ttl: '30m' },
          },
        },
        schema: {
          ...body.text.format.schema,
          $schema: 'https://json-schema.org/draft/2020-12/schema',
        },
        repeatIndex,
      }),
    )
    .digest('hex')
}

/** The translation input of one promptfoo test case. */
export function translateInput(vars: Record<string, unknown>): TranslateInput {
  const text = (name: string, fallback = '') => {
    const value = vars[name]
    return value === undefined || value === null ? fallback : String(value)
  }
  return {
    text: text('text'),
    source: text('source'),
    target: text('target'),
    mode: text('mode'),
    intent: text('intent'),
    uiLang: text('uiLang', 'en'),
    context: text('context'),
    // promptfoo expands array vars into separate tests, so cases store
    // refinements as newline-separated text.
    refinements: text('refinements')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    previousMain: text('previousMain'),
  }
}

// Reads a Responses event stream: output text deltas and the final response.
async function* serverEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, any>> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(
      /\r\n/g,
      '\n',
    )
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (data && data !== '[DONE]') yield JSON.parse(data)
    }
  }
}

async function openAIError(response: Response): Promise<Error> {
  const text = await response.text()
  try {
    const message = JSON.parse(text)?.error?.message
    if (message) return new Error(message)
  } catch {
    // Not JSON: fall through to the status.
  }
  return new Error(`OpenAI answered ${response.status} ${response.statusText}`)
}

// Runs the production translation request for one promptfoo test case. Only
// the model, reasoning effort, service tier and prompt variant differ. The
// body comes from the Go app (cmd/request); this posts it to the OpenAI
// Responses API as the app does (streaming, no retry).
export default class TranslationProvider {
  config: Config
  translateConfig: TranslateConfig
  label: string

  constructor(options: { id?: string; label?: string; config: Config }) {
    this.config = options.config
    // Same validation and defaults as the deployment environment: build one
    // request and read the resolved settings back from it.
    const probe = JSON.parse(
      requestBodySync({
        input: translateInput({
          text: 'probe',
          source: 'en',
          target: 'ko',
          mode: 'casual',
          intent: 'sentence',
        }),
        config: this.requestConfig(),
        variant: options.config.promptVariant,
      }),
    ) as RequestBody
    this.translateConfig = {
      model: probe.model,
      reasoning: probe.reasoning.effort,
      serviceTier: probe.service_tier,
    }
    const { model, reasoning, serviceTier } = this.translateConfig
    this.label =
      options.label ??
      [
        model,
        `reasoning=${reasoning}`,
        serviceTier === 'fast' ? 'fast' : '',
        options.config.promptVariant
          ? `prompt=${options.config.promptVariant}`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
  }

  requestConfig() {
    const { model, reasoning, serviceTier } = this.config
    return { model, reasoning, serviceTier }
  }

  id() {
    const { model, reasoning, serviceTier } = this.translateConfig
    return `translate:${model}:${reasoning}:${serviceTier}:${this.config.promptVariant ?? 'production'}`
  }

  async callApi(_prompt: string, context?: CallContext) {
    const vars = context?.vars ?? {}
    const intent = vars.intent === 'word' ? 'word' : 'sentence'
    const bodyText = await requestBody({
      input: translateInput(vars),
      config: this.requestConfig(),
      variant: this.config.promptVariant,
    })
    const body = JSON.parse(bodyText) as RequestBody
    const config = this.translateConfig

    const key = cacheKey(body, context?.repeatIndex ?? 0)
    const useCache = promptfoo.cache.isCacheEnabled() && !context?.bustCache
    if (useCache) {
      const hit = await readCached(key)
      if (hit) return { ...hit, cached: true }
    }

    const started = performance.now()
    try {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
      const baseURL = (
        process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
      ).replace(/\/+$/, '')
      const response = await fetch(`${baseURL}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: bodyText,
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok || !response.body) throw await openAIError(response)

      let raw = ''
      let ttftMs: number | null = null
      let mainReadyMs: number | null = null
      let completed: { usage?: Usage; service_tier?: string } | undefined
      const mainKey = intent === 'word' ? 'primaryTranslation' : 'main'
      const mainClosed = new RegExp(
        `"${mainKey}"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`,
      )
      for await (const event of serverEvents(response.body)) {
        switch (event.type) {
          case 'response.output_text.delta':
            ttftMs ??= performance.now() - started
            raw += event.delta
            if (mainReadyMs === null && mainClosed.test(raw))
              mainReadyMs = performance.now() - started
            break
          case 'response.completed':
            completed = event.response
            break
          case 'response.failed':
            throw new Error(
              event.response?.error?.message ?? 'OpenAI response failed',
            )
          case 'response.incomplete':
            throw new Error(
              `OpenAI response incomplete: ${event.response?.incomplete_details?.reason ?? 'unknown reason'}`,
            )
          case 'error':
            throw new Error(event.message ?? 'OpenAI stream error')
        }
      }
      if (!completed) throw new Error('stream ended before response.completed')
      const output = validateResult(intent, JSON.parse(raw))

      const usage = completed.usage ?? {}
      const inputTokens = usage.input_tokens ?? 0
      const outputTokens = usage.output_tokens ?? 0
      const cached = usage.input_tokens_details?.cached_tokens ?? 0
      const reasoningTokens = usage.output_tokens_details?.reasoning_tokens
      // OpenAI silently serves the default tier when Fast is unavailable;
      // price what was actually used.
      const servedTier: ServiceTier =
        completed.service_tier === 'default' ? 'default' : config.serviceTier
      const cost = estimateCost(config.model, servedTier, {
        input: inputTokens,
        cached,
        output: outputTokens,
      })
      const result = {
        output: JSON.stringify(output, null, 2),
        tokenUsage: {
          prompt: usage.input_tokens,
          completion: usage.output_tokens,
          total: usage.total_tokens ?? inputTokens + outputTokens,
          cached,
          completionDetails: { reasoning: reasoningTokens },
        },
        ...(cost !== undefined ? { cost } : {}),
        metadata: {
          ttftMs: ttftMs && Math.round(ttftMs),
          mainReadyMs: mainReadyMs && Math.round(mainReadyMs),
          totalMs: Math.round(performance.now() - started),
          reasoningTokens: reasoningTokens ?? 0,
          serviceTier: completed.service_tier ?? null,
        },
      }
      if (useCache) await writeCached(key, result)
      return result
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
}
