import type { LangCode } from './languages'

// Rough client-side detector. We only care about routing decisions (e.g., auto-swap
// target when the user pastes in the language we're already translating to), so a
// script-based heuristic is enough — we don't need to distinguish EN from FR here.
// Pick the dominant script by character count so a stray foreign word inside an
// otherwise-English sentence doesn't flip the detection.
export function detectLanguage(text: string): LangCode | null {
  const t = text.trim()
  if (!t) return null
  const counts: Array<[LangCode, number]> = [
    ['ko', (t.match(/[\uac00-\ud7af]/g) ?? []).length],
    ['ja', (t.match(/[\u3040-\u309f\u30a0-\u30ff]/g) ?? []).length],
    ['zh', (t.match(/[\u4e00-\u9fff]/g) ?? []).length],
    ['en', (t.match(/[A-Za-z]/g) ?? []).length],
  ]
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a))
  return best[1] > 0 ? best[0] : null
}
