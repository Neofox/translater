// Shared with the Go app: shared/translation/i18n/strings.json.
import strings from '../../shared/translation/i18n/strings.json'

export type UiLang = 'en' | 'ko'
export const UI_LANGS: UiLang[] = ['en', 'ko']

export type StringKey = keyof (typeof strings)['en']

// The annotation fails typecheck when a UI language misses a key.
export const STRINGS: Record<UiLang, Record<StringKey, string>> = strings
