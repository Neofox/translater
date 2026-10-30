import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSLATE_MODEL,
  TranslationConfigurationError,
  openaiProviderOptions,
  resolveTranslateConfig,
  translateConfigLabel,
} from './openai'

describe('resolveTranslateConfig', () => {
  it('defaults to the production model on Fast without hidden reasoning', () => {
    expect(resolveTranslateConfig({})).toEqual({
      model: DEFAULT_TRANSLATE_MODEL,
      reasoning: 'none',
      serviceTier: 'fast',
    })
    expect(DEFAULT_TRANSLATE_MODEL).toBe('gpt-6.1-terra')
  })

  it('reads the model, reasoning effort and service tier', () => {
    expect(
      resolveTranslateConfig({
        TRANSLATE_MODEL: 'gpt-6.1-sol',
        TRANSLATE_REASONING: 'low',
        TRANSLATE_SERVICE_TIER: 'fast',
      }),
    ).toEqual({ model: 'gpt-6.1-sol', reasoning: 'low', serviceTier: 'fast' })
  })

  it('accepts a legacy Gateway id for the same OpenAI model', () => {
    expect(
      resolveTranslateConfig({ TRANSLATE_MODEL: 'openai/gpt-6-luna' }).model,
    ).toBe('gpt-6-luna')
  })

  it.each([
    { TRANSLATE_MODEL: 'anthropic/claude-haiku-5.5' },
    { TRANSLATE_MODEL: 'gpt 6' },
    { TRANSLATE_MODEL: 'openai/' },
    { TRANSLATE_REASONING: 'provider-default' },
    { TRANSLATE_SERVICE_TIER: 'priority' },
  ])('rejects %o', (env) => {
    expect(() => resolveTranslateConfig(env)).toThrow(
      TranslationConfigurationError,
    )
  })
})

describe('openaiProviderOptions', () => {
  it('sends effort, tier, no storage and the explicit prompt cache', () => {
    const config = {
      model: 'gpt-6-luna',
      reasoning: 'none',
      serviceTier: 'fast',
    } as const
    expect(
      openaiProviderOptions({
        config,
        promptCacheKey: 'nt:v18:sentence:en:en:ko:casual',
      }),
    ).toEqual({
      openai: {
        reasoningEffort: 'none',
        serviceTier: 'fast',
        store: false,
        promptCacheKey: 'nt:v18:sentence:en:en:ko:casual',
        promptCacheOptions: { mode: 'explicit', ttl: '30m' },
      },
    })
    expect(translateConfigLabel(config)).toBe('gpt-6-luna:none:fast')
  })
})
