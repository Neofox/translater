export type Intent = 'word' | 'sentence'

const SENTENCE_TERMINATORS = /[.!?。！？…]/

export function detectIntent(text: string): Intent {
  const trimmed = text.trim()
  if (!trimmed) return 'sentence'
  if (SENTENCE_TERMINATORS.test(trimmed)) return 'sentence'
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length <= 3 && trimmed.length <= 24) return 'word'
  return 'sentence'
}
