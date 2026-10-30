import {
  APICallError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  NoSuchProviderError,
} from 'ai'
import { STRINGS } from '../lib/i18n'
import type { UiLang } from '../lib/i18n'
import { TranslationConfigurationError } from './openai'

export type TranslationErrorKind =
  | 'configuration'
  | 'authentication'
  | 'budget'
  | 'rate_limit'
  | 'model_configuration'
  | 'structured_output'
  | 'provider'

export function classifyTranslationError(error: unknown): TranslationErrorKind {
  if (
    error instanceof TranslationConfigurationError ||
    LoadAPIKeyError.isInstance(error)
  )
    return 'configuration'
  if (NoSuchProviderError.isInstance(error)) return 'model_configuration'
  if (NoObjectGeneratedError.isInstance(error)) return 'structured_output'

  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return 'authentication'
    }
    if (error.statusCode === 402) return 'budget'
    // OpenAI reports exhausted credit as 429 insufficient_quota.
    if (error.statusCode === 429)
      return /insufficient_quota/.test(error.responseBody ?? '')
        ? 'budget'
        : 'rate_limit'
    if (error.statusCode === 400 || error.statusCode === 404) {
      return 'model_configuration'
    }
  }

  return 'provider'
}

export function isTranslationAbort(
  error: unknown,
  signal: AbortSignal,
): boolean {
  return (
    signal.aborted ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError')
  )
}

export function publicTranslationError(
  kind: TranslationErrorKind,
  uiLang: UiLang,
): Error {
  const strings = STRINGS[uiLang]
  const message = {
    configuration: strings.providerConfigurationFailed,
    authentication: strings.providerAuthenticationFailed,
    budget: strings.providerBudgetUnavailable,
    rate_limit: strings.providerRateLimited,
    model_configuration: strings.providerModelInvalid,
    structured_output: strings.providerStructuredOutputInvalid,
    provider: strings.translationFailed,
  }[kind]

  return new Error(message)
}
