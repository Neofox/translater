import '../src/server/aiSdkWarnings.server.ts'
import './http.ts'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { streamText } from 'ai'
import promptfoo from 'promptfoo'
import { z } from 'zod'
import { resolveTranslateConfig } from '../src/server/openai.ts'
import type { TranslateConfig } from '../src/server/openai.ts'
import { SentenceResult, WordResult } from '../src/server/schemas.ts'
import { translationRequest } from '../src/server/translationRequest.ts'
import { TranslateInput } from '../src/server/translateTypes.ts'
import { SENTENCE_SYSTEMS } from './promptVariants.ts'
import type { PromptVariant } from './promptVariants.ts'
import { estimateCost } from './pricing.ts'

type Config = {
  model: string
  reasoning?: string
  serviceTier?: string
  promptVariant?: PromptVariant
}

type CallContext = {
  vars: Record<string, unknown>
  repeatIndex?: number
  bustCache?: boolean
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

// Runs the production translation request for one promptfoo test case. Only
// the model, reasoning effort, service tier and prompt variant differ.
export default class TranslationProvider {
  config: Config
  translateConfig: TranslateConfig
  label: string

  constructor(options: { id?: string; label?: string; config: Config }) {
    this.config = options.config
    // Same validation as the deployment environment.
    this.translateConfig = resolveTranslateConfig({
      TRANSLATE_MODEL: options.config.model,
      TRANSLATE_REASONING: options.config.reasoning,
      TRANSLATE_SERVICE_TIER: options.config.serviceTier,
    })
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

  id() {
    const { model, reasoning, serviceTier } = this.translateConfig
    return `translate:${model}:${reasoning}:${serviceTier}:${this.config.promptVariant ?? 'production'}`
  }

  async callApi(_prompt: string, context?: CallContext) {
    const vars = context?.vars ?? {}
    const data = TranslateInput.parse({
      ...vars,
      // promptfoo expands array vars into separate tests, so cases store
      // refinements as newline-separated text.
      refinements: String(vars.refinements ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    })
    const config = this.translateConfig
    const request = translationRequest(
      data,
      config,
      SENTENCE_SYSTEMS[this.config.promptVariant ?? 'production'],
    )

    // Any change to the prompt, schema, model, reasoning, tier or repeat index
    // is a new key, so prompt edits never reuse stale outputs.
    const cacheKey = createHash('sha256')
      .update(
        JSON.stringify({
          provider: 'openai',
          model: config.model,
          instructions: request.instructions,
          messages: request.messages,
          providerOptions: request.providerOptions,
          schema: z.toJSONSchema(
            data.intent === 'word' ? WordResult : SentenceResult,
          ),
          repeatIndex: context?.repeatIndex ?? 0,
        }),
      )
      .digest('hex')
    const useCache = promptfoo.cache.isCacheEnabled() && !context?.bustCache
    if (useCache) {
      const hit = await readCached(cacheKey)
      if (hit) return { ...hit, cached: true }
    }

    const started = performance.now()
    try {
      const result = streamText({
        ...request,
        timeout: 120_000,
        telemetry: { isEnabled: false },
      })
      let raw = ''
      let ttftMs: number | null = null
      let mainReadyMs: number | null = null
      const mainKey = data.intent === 'word' ? 'primaryTranslation' : 'main'
      const mainClosed = new RegExp(
        `"${mainKey}"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`,
      )
      for await (const delta of result.textStream) {
        ttftMs ??= performance.now() - started
        raw += delta
        if (mainReadyMs === null && mainClosed.test(raw))
          mainReadyMs = performance.now() - started
      }
      const [output, usage, providerMetadata] = await Promise.all([
        result.output,
        result.usage,
        result.providerMetadata,
      ])
      const cached = usage.inputTokenDetails.cacheReadTokens ?? 0
      // OpenAI silently serves the default tier when Fast is unavailable;
      // price what was actually used.
      const servedTier =
        (providerMetadata?.openai as { serviceTier?: string } | undefined)
          ?.serviceTier === 'default'
          ? 'default'
          : config.serviceTier
      const cost = estimateCost(config.model, servedTier, {
        input: usage.inputTokens ?? 0,
        cached,
        output: usage.outputTokens ?? 0,
      })
      const response = {
        output: JSON.stringify(output, null, 2),
        tokenUsage: {
          prompt: usage.inputTokens,
          completion: usage.outputTokens,
          total: usage.totalTokens,
          cached,
          completionDetails: {
            reasoning: usage.outputTokenDetails.reasoningTokens,
          },
        },
        ...(cost !== undefined ? { cost } : {}),
        metadata: {
          ttftMs: ttftMs && Math.round(ttftMs),
          mainReadyMs: mainReadyMs && Math.round(mainReadyMs),
          totalMs: Math.round(performance.now() - started),
          reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
          serviceTier:
            (providerMetadata?.openai as { serviceTier?: string } | undefined)
              ?.serviceTier ?? null,
        },
      }
      if (useCache) await writeCached(cacheKey, response)
      return response
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
}
