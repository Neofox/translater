import { createOpenAI } from '@ai-sdk/openai'
import type { JSONValue } from 'ai'

// Chosen on 2026-10-30 evals: as fast as luna to the main translation (Fast
// tier) with clearly better explanations; sol-low was better still but slower.
export const DEFAULT_TRANSLATE_MODEL = 'gpt-6.1-terra'

export const SERVICE_TIERS = ['default', 'fast'] as const
export type ServiceTier = (typeof SERVICE_TIERS)[number]

export const REASONING_EFFORTS = ['none', 'low', 'medium'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export class TranslationConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranslationConfigurationError'
  }
}

type TranslationEnvironment = {
  TRANSLATE_MODEL?: string
  TRANSLATE_REASONING?: string
  TRANSLATE_SERVICE_TIER?: string
}

export type TranslateConfig = {
  /** Exact OpenAI model id, e.g. `gpt-6-luna`. */
  model: string
  reasoning: ReasoningEffort
  serviceTier: ServiceTier
}

function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const chosen = value?.trim() || fallback
  if (!(allowed as readonly string[]).includes(chosen)) {
    throw new TranslationConfigurationError(
      `${name} must be one of: ${allowed.join(', ')}.`,
    )
  }
  return chosen as T
}

export function resolveTranslateConfig(
  env: TranslationEnvironment = process.env,
): TranslateConfig {
  // Older deployments used Gateway ids; `openai/gpt-6-luna` still means the
  // same OpenAI model. Any other provider prefix is no longer reachable.
  const model = (env.TRANSLATE_MODEL?.trim() || DEFAULT_TRANSLATE_MODEL)
    .replace(/^openai\//, '')
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new TranslationConfigurationError(
      'TRANSLATE_MODEL must be one exact OpenAI model id.',
    )
  }
  return {
    model,
    reasoning: oneOf(
      'TRANSLATE_REASONING',
      env.TRANSLATE_REASONING,
      REASONING_EFFORTS,
      'none',
    ),
    serviceTier: oneOf(
      'TRANSLATE_SERVICE_TIER',
      env.TRANSLATE_SERVICE_TIER,
      SERVICE_TIERS,
      'fast',
    ),
  }
}

/** Short stable label for cache keys, telemetry and eval reports. */
export function translateConfigLabel(config: TranslateConfig): string {
  return `${config.model}:${config.reasoning}:${config.serviceTier}`
}

// Reads OPENAI_API_KEY when a request is made, so a missing key surfaces as a
// classified configuration error instead of failing at import.
export const openai = createOpenAI()

export function openaiProviderOptions(input: {
  config: TranslateConfig
  promptCacheKey: string
}): Record<string, Record<string, JSONValue>> {
  return {
    openai: {
      reasoningEffort: input.config.reasoning,
      serviceTier: input.config.serviceTier,
      store: false,
      promptCacheKey: input.promptCacheKey,
      promptCacheOptions: {
        mode: 'explicit',
        ttl: '30m',
      },
    },
  }
}
