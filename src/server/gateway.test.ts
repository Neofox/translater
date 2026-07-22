import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSLATE_MODEL,
  GatewayConfigurationError,
  assertGatewayAuthentication,
  gatewayProviderOptions,
  gatewayTags,
  resolveTranslateModel,
} from './gateway'

describe('resolveTranslateModel', () => {
  it('defaults to the exact Gateway model id', () => {
    expect(resolveTranslateModel({})).toBe(DEFAULT_TRANSLATE_MODEL)
    expect(DEFAULT_TRANSLATE_MODEL).toBe('openai/gpt-5.6-luna')
  })

  it('accepts one exact provider/model id', () => {
    expect(
      resolveTranslateModel({
        TRANSLATE_MODEL: 'anthropic/claude-sonnet-4.5',
      }),
    ).toBe('anthropic/claude-sonnet-4.5')
  })

  it.each(['gpt-5.6-luna', 'openai/', '/gpt-5.6-luna', 'openai/model/extra'])(
    'rejects malformed model id %s',
    (model) => {
      expect(() => resolveTranslateModel({ TRANSLATE_MODEL: model })).toThrow(
        GatewayConfigurationError,
      )
    },
  )
})

describe('assertGatewayAuthentication', () => {
  it('fails closed when neither Gateway credential is configured', () => {
    expect(() => assertGatewayAuthentication({})).toThrow(
      GatewayConfigurationError,
    )
  })

  it('accepts a non-empty API key', () => {
    expect(() =>
      assertGatewayAuthentication({ AI_GATEWAY_API_KEY: 'test-key' }),
    ).not.toThrow()
  })

  it('accepts a Vercel OIDC token', () => {
    expect(() =>
      assertGatewayAuthentication({ VERCEL_OIDC_TOKEN: 'test-oidc-token' }),
    ).not.toThrow()
  })
})

describe('gatewayProviderOptions', () => {
  it('uses auto caching and OpenAI-only options for openai models', () => {
    expect(
      gatewayProviderOptions({
        model: 'openai/gpt-5.6-luna',
        promptCacheKey: 'nt:v12:sentence:en:en:ko:casual',
        tags: ['translation', 'sentence', 'initial', 'v12-ai-gateway'],
      }),
    ).toEqual({
      gateway: {
        caching: 'auto',
        tags: ['translation', 'sentence', 'initial', 'v12-ai-gateway'],
      },
      openai: {
        reasoningEffort: 'none',
        store: false,
        promptCacheKey: 'nt:v12:sentence:en:en:ko:casual',
        promptCacheOptions: {
          mode: 'explicit',
          ttl: '30m',
        },
      },
    })
  })

  it('does not send OpenAI options or fallback models to another provider', () => {
    const options = gatewayProviderOptions({
      model: 'anthropic/claude-sonnet-4.5',
      promptCacheKey: 'ignored-by-anthropic',
      tags: ['translation', 'word', 'initial', 'v12-ai-gateway'],
    })
    expect(options).toEqual({
      gateway: {
        caching: 'auto',
        tags: ['translation', 'word', 'initial', 'v12-ai-gateway'],
      },
    })
    expect(options.gateway).not.toHaveProperty('models')
  })
})

describe('gatewayTags', () => {
  it('contains only low-cardinality operational values', () => {
    expect(
      gatewayTags({
        intent: 'sentence',
        requestKind: 'refinement',
        promptVersion: 'v12-ai-gateway',
      }),
    ).toEqual(['translation', 'sentence', 'refinement', 'v12-ai-gateway'])
  })
})
