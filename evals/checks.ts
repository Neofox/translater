import {
  isCharacterOrigin,
  prepareLearningResult,
} from '../src/lib/learningRanges.ts'
import { learningSide } from '../src/lib/learningSide.ts'
import { SentenceResult, WordResult } from '../src/server/schemas.ts'

export type Vars = {
  text: string
  source: string
  target: string
  intent: 'sentence' | 'word'
  uiLang?: 'en' | 'ko'
  expectSource?: string
}

export const letters = (text: string, script: RegExp) =>
  [...text].filter((c) => script.test(c)).length

// Explanations may quote the analysed language, so check the dominant script
// rather than rejecting every foreign character.
function explanationLanguageOk(prose: string, uiLang: 'en' | 'ko') {
  const latin = letters(prose, /\p{Script=Latin}/u)
  const hangul = letters(prose, /\p{Script=Hangul}/u)
  const total = letters(prose, /\p{L}/u)
  if (!total) return true
  return uiLang === 'ko' ? hangul / total >= 0.3 : latin / total >= 0.5
}

// Deterministic checks for one output. Each failed check lowers the score and
// is named in the reason; LLM judges cover quality separately.
export default function checks(
  output: string,
  context: { vars: Vars },
): { pass: boolean; score: number; reason: string } {
  const vars = context.vars
  const uiLang = vars.uiLang ?? 'en'
  const failures: string[] = []
  let total = 0
  const check = (ok: boolean, failure: string) => {
    total += 1
    if (!ok) failures.push(failure)
  }

  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    return { pass: false, score: 0, reason: 'output is not JSON' }
  }
  const schema = vars.intent === 'word' ? WordResult : SentenceResult
  const parsed = schema.safeParse(value)
  if (!parsed.success)
    return { pass: false, score: 0, reason: 'schema validation failed' }
  const result = parsed.data

  const expectedSource =
    vars.expectSource ?? (vars.source === 'auto' ? undefined : vars.source)
  if (expectedSource)
    check(
      result.sourceLang === expectedSource,
      `sourceLang ${result.sourceLang} != ${expectedSource}`,
    )
  check(
    result.targetLang === vars.target,
    `targetLang ${result.targetLang} != ${vars.target}`,
  )

  const source = vars.text.trim()
  if ('main' in result) {
    check(result.main.trim() !== source, 'main copies the source')
    const longInput =
      source.includes('\n') ||
      (source.match(/[.!?。！？](\s|$)/g) ?? []).length >= 3
    if (longInput)
      check(result.alternatives.length === 0, 'long input has alternatives')
    check(
      // The app trims newlines wrapped around main (useTranslate trimMain).
      source.trim().split('\n').length ===
        result.main.trim().split('\n').length,
      'line breaks not preserved',
    )
    check(
      explanationLanguageOk(
        [
          result.rationale,
          result.formalityNote,
          ...result.alternatives.map((a) => a.note),
          ...result.learningPhrases.flatMap((p) => [
            p.gloss,
            p.grammar,
            p.usageNote,
            p.literalMeaning,
            p.naturalMeaning,
            p.omissions,
          ]),
        ].join(' '),
        uiLang,
      ),
      `explanations not mainly in ${uiLang}`,
    )

    const side = learningSide(result.sourceLang, result.targetLang, uiLang)
    const learningText = side === 'source' ? source : result.main
    const counterpart = side === 'source' ? result.main : source
    const prepared = prepareLearningResult(
      counterpart,
      learningText,
      result.learningPhrases,
    )
    check(Boolean(prepared), `learningPhrases do not quote the ${side} text`)
    check(prepared?.partial === false, 'learningPhrases leave text uncovered')
    const quoted = result.learningPhrases.reduce(
      (sum, p) => sum + p.grammarHighlights.length,
      0,
    )
    const resolved = (prepared?.chunks ?? []).reduce(
      (sum, c) => sum + (c.grammarHighlights?.length ?? 0),
      0,
    )
    const notes = result.learningPhrases.flatMap((p) =>
      p.characters.map((note) => ({ note, text: p.text })),
    )
    const badNotes = notes.filter(
      ({ note, text }) => !text.includes(note.word) || !isCharacterOrigin(note),
    )
    check(
      badNotes.length === 0,
      `${badNotes.length} invalid character notes (${badNotes.map((b) => b.note.word).join(', ')})`,
    )
    // Same-language polishing often has no grammar worth underlining.
    if (result.sourceLang !== result.targetLang)
      check(quoted > 0, 'no grammar highlights')
    check(
      resolved === quoted,
      `${quoted - resolved} grammar highlights do not resolve`,
    )
  } else {
    check(
      result.primaryTranslation.trim() !== source,
      'primaryTranslation copies the headword',
    )
    check(result.posList.length > 0, 'no parts of speech')
    check(result.characters.every(isCharacterOrigin), 'invalid character notes')
    check(
      result.posList.every((p) => p.senses.every((s) => s.examples.length > 0)),
      'sense without examples',
    )
    check(
      explanationLanguageOk(
        [
          result.primaryUsageNote,
          result.notes,
          result.grammar,
          result.etymology,
          ...result.alternativeTranslations.map((a) => a.note),
          ...result.posList.flatMap((p) => p.senses.map((s) => s.definition)),
        ].join(' '),
        uiLang,
      ),
      `explanations not mainly in ${uiLang}`,
    )
  }

  const score = (total - failures.length) / total
  return {
    pass: failures.length === 0,
    score,
    reason: failures.length
      ? failures.join('; ')
      : `all ${total} checks passed`,
  }
}
