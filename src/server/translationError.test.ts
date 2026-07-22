import { APICallError, NoObjectGeneratedError, NoSuchProviderError } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyTranslationError,
  isTranslationAbort,
  publicTranslationError,
} from './translationError'

function apiError(statusCode: number): unknown {
  return {
    name: 'AI_APICallError',
    statusCode,
    message: 'upstream echoed private source text',
    responseBody: 'private provider body',
  }
}

describe('classifyTranslationError', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    [401, 'authentication'],
    [403, 'authentication'],
    [402, 'budget'],
    [429, 'rate_limit'],
    [400, 'model_configuration'],
    [404, 'model_configuration'],
  ] as const)('maps HTTP %i to %s', (status, expected) => {
    const error = apiError(status)
    vi.spyOn(APICallError, 'isInstance').mockImplementation(
      (candidate): candidate is APICallError => candidate === error,
    )
    expect(classifyTranslationError(error)).toBe(expected)
  })

  it('maps provider resolution and structured output failures', () => {
    const providerError = { name: 'AI_NoSuchProviderError' }
    const objectError = { name: 'AI_NoObjectGeneratedError' }
    vi.spyOn(NoSuchProviderError, 'isInstance').mockImplementation(
      (candidate): candidate is NoSuchProviderError =>
        candidate === providerError,
    )
    vi.spyOn(NoObjectGeneratedError, 'isInstance').mockImplementation(
      (candidate): candidate is NoObjectGeneratedError =>
        candidate === objectError,
    )
    expect(classifyTranslationError(providerError)).toBe('model_configuration')
    expect(classifyTranslationError(objectError)).toBe('structured_output')
  })

  it('never exposes the provider body or message to the browser', () => {
    const error = apiError(401)
    vi.spyOn(APICallError, 'isInstance').mockImplementation(
      (candidate): candidate is APICallError => candidate === error,
    )
    const publicError = publicTranslationError(
      classifyTranslationError(error),
      'en',
    )
    expect(publicError.message).toContain('AI_GATEWAY_API_KEY')
    expect(publicError.message).not.toContain('private')
    expect(publicError).not.toHaveProperty('cause')
  })
})

describe('isTranslationAbort', () => {
  it('recognizes the request signal and AbortError', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isTranslationAbort(new Error('anything'), controller.signal)).toBe(
      true,
    )
    expect(
      isTranslationAbort(
        new DOMException('Aborted', 'AbortError'),
        new AbortController().signal,
      ),
    ).toBe(true)
  })
})
