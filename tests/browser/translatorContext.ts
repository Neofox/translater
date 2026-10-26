import type { useTranslatorContext as realContext } from '../../src/context/TranslatorContext'

export function useTranslatorContext(): ReturnType<typeof realContext> {
  throw new Error('Browser fixtures must provide translation state')
}
