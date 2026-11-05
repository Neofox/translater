// Shared with the Go app: shared/translation/languages.json.
import languages from '../../shared/translation/languages.json'

export type LangCode = 'auto' | 'en' | 'ko' | 'ja' | 'fr' | 'es' | 'zh'

type LanguageEntry = {
  code: LangCode
  label: string
  promptName: string
}

export const LANGUAGES = languages as ReadonlyArray<LanguageEntry>

export function promptNameFor(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.promptName ?? code
}
