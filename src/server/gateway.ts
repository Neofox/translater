import type { JSONValue } from 'ai'

export const DEFAULT_TRANSLATE_MODEL = 'openai/gpt-5.6-luna'

export class GatewayConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GatewayConfigurationError'
  }
}

type TranslationEnvironment = {
  AI_GATEWAY_API_KEY?: string
  TRANSLATE_MODEL?: string
}

export function resolveTranslateModel(
  env: TranslationEnvironment = process.env,
): string {
  const model = env.TRANSLATE_MODEL?.trim() || DEFAULT_TRANSLATE_MODEL
  if (!/^[^/\s]+\/[^/\s]+$/.test(model)) {
    throw new GatewayConfigurationError(
      'TRANSLATE_MODEL must be one exact provider/model identifier.',
    )
  }
  return model
}

export function assertGatewayApiKey(
  env: TranslationEnvironment = process.env,
): void {
  if (!env.AI_GATEWAY_API_KEY?.trim()) {
    throw new GatewayConfigurationError('AI_GATEWAY_API_KEY is not configured.')
  }
}

export function gatewayTags(input: {
  intent: 'word' | 'sentence'
  requestKind: 'initial' | 'context' | 'refinement'
  promptVersion: string
}): string[] {
  return [
    'translation',
    input.intent,
    input.requestKind,
    input.promptVersion,
  ]
}

export function gatewayProviderOptions(input: {
  model: string
  promptCacheKey: string
  tags: string[]
}): Record<string, Record<string, JSONValue>> {
  const options: Record<string, Record<string, JSONValue>> = {
    gateway: { caching: 'auto', tags: input.tags },
  }
  if (!input.model.startsWith('openai/')) return options

  options.openai = {
    reasoningEffort: 'none',
    store: false,
    promptCacheKey: input.promptCacheKey,
  }
  return options
}
