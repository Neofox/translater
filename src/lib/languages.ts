export type LangCode = 'auto' | 'en' | 'ko' | 'ja' | 'fr' | 'es' | 'zh'

export const LANGUAGES: ReadonlyArray<{ code: LangCode; label: string }> = [
  { code: 'auto', label: 'Auto' },
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
]

export function labelFor(code: string) {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code
}
