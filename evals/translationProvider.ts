import '../src/server/aiSdkWarnings.server.ts'
import './http.ts'
import { createHash } from 'node:crypto'
import { streamText } from 'ai'
import promptfoo from 'promptfoo'
import { z } from 'zod'
import { SentenceResult, WordResult } from '../src/server/schemas.ts'
import { translationRequest } from '../src/server/translationRequest.ts'
import { TranslateInput } from '../src/server/translateTypes.ts'
import { SENTENCE_SYSTEMS } from './promptVariants.ts'
import type { PromptVariant } from './promptVariants.ts'

type ReasoningLevel = NonNullable<Parameters<typeof streamText>[0]['reasoning']>

type Config = {
  model: string
  reasoning?: ReasoningLevel
  promptVariant?: PromptVariant
}

type CallContext = {
  vars: Record<string, unknown>
  repeatIndex?: number
  bustCache?: boolean
}

// Runs the production translation request for one promptfoo test case. Only
// the model and reasoning level vary between providers in the config.
export default class TranslationProvider {
  config: Config
  label: string

  constructor(options: { id?: string; label?: string; config: Config }) {
    this.config = options.config
    this.label =
      options.label ??
      [
        options.config.model,
        `reasoning=${options.config.reasoning ?? 'none'}`,
        options.config.promptVariant
          ? `prompt=${options.config.promptVariant}`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
  }

  id() {
    return `translate:${this.config.model}:${this.config.reasoning ?? 'none'}:${this.config.promptVariant ?? 'production'}`
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
    const reasoning = this.config.reasoning ?? 'none'
    const request = translationRequest(
      data,
      this.config.model,
      SENTENCE_SYSTEMS[this.config.promptVariant ?? 'production'],
    )
    // Keep eval spend out of production Gateway reporting.
    const gateway = request.providerOptions.gateway as { tags: string[] }
    gateway.tags = ['eval', ...gateway.tags.filter((t) => t !== 'translation')]
    const openai = request.providerOptions.openai as
      Record<string, unknown> | undefined
    if (openai) {
      // Provider-specific effort wins over the portable setting.
      if (reasoning === 'provider-default') delete openai.reasoningEffort
      else openai.reasoningEffort = reasoning
    }

    // Any change to the prompt, schema, model, reasoning or repeat index is a
    // new key, so prompt edits never reuse stale outputs.
    const cacheKey = `neotranslate:${createHash('sha256')
      .update(
        JSON.stringify({
          model: this.config.model,
          reasoning,
          instructions: request.instructions,
          messages: request.messages,
          providerOptions: request.providerOptions,
          schema: z.toJSONSchema(
            data.intent === 'word' ? WordResult : SentenceResult,
          ),
          repeatIndex: context?.repeatIndex ?? 0,
        }),
      )
      .digest('hex')}`
    const useCache = promptfoo.cache.isCacheEnabled() && !context?.bustCache
    if (useCache) {
      const hit = await promptfoo.cache.getCache().get<object>(cacheKey)
      if (hit) return { ...hit, cached: true }
    }

    const started = performance.now()
    try {
      const result = streamText({
        ...request,
        reasoning,
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
      const cost = Number(
        (providerMetadata?.gateway as { cost?: unknown } | undefined)?.cost,
      )
      const response = {
        output: JSON.stringify(output, null, 2),
        tokenUsage: {
          prompt: usage.inputTokens,
          completion: usage.outputTokens,
          total: usage.totalTokens,
          cached: usage.inputTokenDetails.cacheReadTokens,
          completionDetails: {
            reasoning: usage.outputTokenDetails.reasoningTokens,
          },
        },
        ...(Number.isFinite(cost) ? { cost } : {}),
        metadata: {
          ttftMs: ttftMs && Math.round(ttftMs),
          mainReadyMs: mainReadyMs && Math.round(mainReadyMs),
          totalMs: Math.round(performance.now() - started),
          reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
        },
      }
      if (useCache) await promptfoo.cache.getCache().set(cacheKey, response)
      return response
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
}
