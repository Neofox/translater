// Long-form input — multiple lines, several sentences, or paragraph-style
// text. Alternative phrasings only make sense for short single-sentence
// input, so the UI hides them (and the prompt suppresses them) past this.
const SENTENCE_BREAK = /[.!?。！？…]['")\]]?\s+\S/g

export function isLongForm(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.includes('\n')) return true
  if (trimmed.length > 200) return true
  // ≥2 mid-text sentence breaks (3+ sentences). A single break is tolerated
  // so abbreviations ("Mr. Smith") and trailing ellipses ("wait... what")
  // don't count a short message as long-form.
  const breaks = trimmed.match(SENTENCE_BREAK)
  return (breaks?.length ?? 0) >= 2
}
