import { detectAll } from 'tinyld/light'
import type { LangCode } from './languages'

// Client-side detector for routing decisions (auto-flip target, Auto-chip label).
// CJK scripts are unambiguous, so counting characters is reliable and free.
// Latin scripts all look alike to a regex, so we hand those to tinyld restricted
// to the Latin languages we support. Low confidence falls back to English —
// wrong-but-stable beats flickering, and the model's own report corrects us.
const LATIN_LANGS = ['en', 'fr', 'es']
const MIN_ACCURACY = 0.5

export function detectLanguage(text: string): LangCode | null {
  const t = text.trim()
  if (!t) return null

  const kana = (t.match(/[぀-ゟ゠-ヿ]/g) ?? []).length
  const hangul = (t.match(/[가-힯]/g) ?? []).length
  const hanzi = (t.match(/[一-鿿]/g) ?? []).length
  const latin = (t.match(/[A-Za-z]/g) ?? []).length

  const cjk = kana + hangul + hanzi
  if (cjk > 0 && cjk >= latin) {
    // Any kana means Japanese — kanji-heavy sentences would otherwise count as zh.
    if (kana > 0 && kana + hanzi >= hangul) return 'ja'
    return hangul >= hanzi ? 'ko' : 'zh'
  }

  if (latin === 0) return null

  const best = detectAll(t, { only: LATIN_LANGS })[0]
  return best && best.accuracy >= MIN_ACCURACY ? (best.lang as LangCode) : 'en'
}
