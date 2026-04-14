import type { LangCode } from './languages'

// Rough client-side detector. We only care about routing decisions (e.g., auto-swap
// target when the user pastes in the language we're already translating to), so a
// script-based heuristic is enough — we don't need to distinguish EN from FR here.
export function detectLanguage(text: string): LangCode | null {
  const t = text.trim()
  if (!t) return null
  if (/[\uac00-\ud7af]/.test(t)) return 'ko'
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(t)) return 'ja'
  if (/[\u4e00-\u9fff]/.test(t)) return 'zh'
  // No Latin-specific distinction; default to English for roman script.
  if (/[A-Za-z]/.test(t)) return 'en'
  return null
}
