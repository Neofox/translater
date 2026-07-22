import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SAFE_TRANSLATION_CONTEXT_KEYS,
  isLangfuseConfigured,
  prepareTranslationTelemetry,
  resetTranslationTelemetryForTests,
  translationRuntimeContext,
  translationTelemetryOptions,
} from './telemetry'

describe('translationTelemetryOptions', () => {
  it('enables native telemetry without recording translation content', () => {
    expect(translationTelemetryOptions(true)).toEqual({
      isEnabled: true,
      recordInputs: false,
      recordOutputs: false,
      functionId: 'translation',
      includeRuntimeContext: SAFE_TRANSLATION_CONTEXT_KEYS,
    })
  })

  it('disables telemetry when Langfuse is not configured', () => {
    expect(translationTelemetryOptions(false).isEnabled).toBe(false)
  })
})

describe('translationRuntimeContext', () => {
  it('contains only allowlisted operational dimensions', () => {
    const context = translationRuntimeContext(
      {
        intent: 'sentence',
        mode: 'casual',
        source: 'en',
        target: 'ko',
        uiLang: 'en',
        text: 'private source text',
        context: 'private reply context',
        refinements: ['private adjustment'],
        previousMain: 'private previous result',
        analyticsTrigger: 'refinement',
        analyticsSessionId: 'session-id',
        analyticsRunId: 'run-id',
        analyticsSupersedesRunId: 'old-run-id',
        analyticsInputRevision: 3,
      },
      'openai/gpt-5.6-luna',
      'v12-ai-gateway',
    )

    expect(Object.keys(context).sort()).toEqual(
      Object.keys(SAFE_TRANSLATION_CONTEXT_KEYS).sort(),
    )
    expect(JSON.stringify(context)).not.toContain('private source text')
    expect(JSON.stringify(context)).not.toContain('private reply context')
    expect(JSON.stringify(context)).not.toContain('private adjustment')
    expect(JSON.stringify(context)).not.toContain('private previous result')
  })
})

describe('isLangfuseConfigured', () => {
  it('requires both credentials', () => {
    expect(isLangfuseConfigured({})).toBe(false)
    expect(isLangfuseConfigured({ LANGFUSE_PUBLIC_KEY: 'pk' })).toBe(false)
    expect(
      isLangfuseConfigured({
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: 'sk',
      }),
    ).toBe(true)
  })
})

describe('prepareTranslationTelemetry', () => {
  afterEach(() => {
    resetTranslationTelemetryForTests()
    vi.restoreAllMocks()
  })

  it('registers the official integration once and exposes forceFlush', async () => {
    const registerTelemetry = vi.fn()
    const start = vi.fn()
    const forceFlush = vi.fn().mockResolvedValue(undefined)
    const first = await prepareTranslationTelemetry({
      env: { LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' },
      load: async () => ({
        registerTelemetry,
        integration: {},
        start,
        forceFlush,
      }),
    })
    const second = await prepareTranslationTelemetry({
      env: { LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' },
      load: async () => {
        throw new Error('must not initialize twice')
      },
    })

    expect(start).toHaveBeenCalledTimes(1)
    expect(registerTelemetry).toHaveBeenCalledTimes(1)
    expect(first.enabled).toBe(true)
    expect(second.enabled).toBe(true)
    await first.flush()
    expect(forceFlush).toHaveBeenCalledTimes(1)
  })

  it('does not load telemetry packages without both credentials', async () => {
    const load = vi.fn()
    const telemetry = await prepareTranslationTelemetry({
      env: { LANGFUSE_PUBLIC_KEY: 'pk' },
      load,
    })
    expect(telemetry.enabled).toBe(false)
    expect(load).not.toHaveBeenCalled()
  })

  it('fails open when telemetry initialization fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const telemetry = await prepareTranslationTelemetry({
      env: { LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' },
      load: async () => {
        throw new Error('telemetry unavailable')
      },
    })
    expect(telemetry.enabled).toBe(false)
    await expect(telemetry.flush()).resolves.toBeUndefined()
    expect(warning).toHaveBeenCalledWith(
      '[langfuse] initialization failed; translations will continue untraced',
    )
  })

  it('keeps translation successful when serverless flush fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const telemetry = await prepareTranslationTelemetry({
      env: { LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' },
      load: async () => ({
        registerTelemetry: vi.fn(),
        integration: {},
        start: vi.fn(),
        forceFlush: vi.fn().mockRejectedValue(new Error('private exporter')),
      }),
    })

    await expect(telemetry.flush()).resolves.toBeUndefined()
    expect(warning).toHaveBeenCalledWith(
      '[langfuse] trace flush failed; translations will continue',
    )
  })
})
