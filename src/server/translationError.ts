import { APICallError, NoObjectGeneratedError, NoSuchProviderError } from 'ai'
import { STRINGS } from '../lib/i18n'
import type { UiLang } from '../lib/i18n'
import { GatewayConfigurationError } from './gateway'

export type TranslationErrorKind =
  | 'configuration'
  | 'authentication'
  | 'budget'
  | 'rate_limit'
  | 'model_configuration'
  | 'structured_output'
  | 'provider'

export function classifyTranslationError(error: unknown): TranslationErrorKind {
  if (error instanceof GatewayConfigurationError) return 'configuration'
  if (NoSuchProviderError.isInstance(error)) return 'model_configuration'
  if (NoObjectGeneratedError.isInstance(error)) return 'structured_output'

  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return 'authentication'
    }
    if (error.statusCode === 402) return 'budget'
    if (error.statusCode === 429) return 'rate_limit'
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
    configuration: strings.gatewayConfigurationFailed,
    authentication: strings.gatewayAuthenticationFailed,
    budget: strings.gatewayBudgetUnavailable,
    rate_limit: strings.gatewayRateLimited,
    model_configuration: strings.gatewayModelInvalid,
    structured_output: strings.gatewayStructuredOutputInvalid,
    provider: strings.translationFailed,
  }[kind]

  return new Error(message)
}
