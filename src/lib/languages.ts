export type LangCode = 'auto' | 'en' | 'ko' | 'ja' | 'fr' | 'es' | 'zh'

type LanguageEntry = {
  code: LangCode
  label: string
  promptName: string
}

export const LANGUAGES: ReadonlyArray<LanguageEntry> = [
  {
    code: 'auto',
    label: 'Auto',
    promptName: 'the auto-detected source language',
  },
  { code: 'en', label: 'English', promptName: 'English' },
  { code: 'ko', label: '한국어', promptName: 'Korean' },
  { code: 'ja', label: '日本語', promptName: 'Japanese' },
  { code: 'fr', label: 'Français', promptName: 'French' },
  { code: 'es', label: 'Español', promptName: 'Spanish' },
  { code: 'zh', label: '中文', promptName: 'Chinese' },
]

export function promptNameFor(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.promptName ?? code
}
