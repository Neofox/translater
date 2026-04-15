export type Intent = 'word' | 'sentence'

const SENTENCE_TERMINATORS = /[.!?。！？…]/

export function detectIntent(text: string): Intent {
  const trimmed = text.trim()
  if (!trimmed) return 'sentence'
  if (SENTENCE_TERMINATORS.test(trimmed)) return 'sentence'
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  // ≤2 tokens covers single words and MWEs like "thank you" / "get up".
  // 3+ tokens is almost always a phrase or sentence (e.g. "open the browser").
  if (tokens.length <= 2 && trimmed.length <= 24) return 'word'
  return 'sentence'
}
