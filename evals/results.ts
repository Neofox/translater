import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv } from 'ajv'

// Strict validation of a translation result against the shared result
// schemas (the schemas the request sends as text.format.schema), plus the
// few learner rules the deterministic checks reuse.

const SCHEMAS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'shared/translation/schemas',
)

const ajv = new Ajv({ allErrors: true })
const validators = {
  sentence: ajv.compile(
    JSON.parse(readFileSync(join(SCHEMAS, 'sentence.json'), 'utf8')),
  ),
  word: ajv.compile(
    JSON.parse(readFileSync(join(SCHEMAS, 'word.json'), 'utf8')),
  ),
}

export type CharacterNote = {
  word: string
  chars: { char: string; meaning: string }[]
}

export type LearningPhrase = {
  text: string
  gloss: string
  sourceTexts: string[]
  baseForm: string
  literalMeaning: string
  naturalMeaning: string
  grammar: string
  omissions: string
  usageNote: string
  characters: CharacterNote[]
  grammarHighlights: string[]
}

/** The fields of schemas/sentence.json the checks read. */
export type SentenceResult = {
  sourceLang: string
  targetLang: string
  main: string
  learningPhrases: LearningPhrase[]
  rationale: string
  alternatives: { text: string; note: string }[]
  formalityNote: string
}

/** The fields of schemas/word.json the checks read. */
export type WordResult = {
  sourceLang: string
  targetLang: string
  primaryTranslation: string
  primaryUsageNote: string
  alternativeTranslations: { note: string }[]
  posList: { senses: { definition: string; examples: unknown[] }[] }[]
  characters: CharacterNote[]
  grammar: string
  etymology: string
  notes: string
}

/** Throws when value does not match the intent's result schema. */
export function validateResult(
  intent: 'sentence' | 'word',
  value: unknown,
): SentenceResult | WordResult {
  const validate = validators[intent]
  if (!validate(value)) {
    throw new Error(
      `${intent} result does not match the schema: ${ajv.errorsText(validate.errors)}`,
    )
  }
  return value as SentenceResult | WordResult
}

/** The UI language is the user's fluent language: learn the other side. */
export function learningSide(source: string, target: string, uiLang: string) {
  return target === uiLang && source !== uiLang ? 'source' : 'target'
}

// Models sometimes "explain" native Korean words by glossing their Hangul
// syllables as characters. Keep a note only when every char is a real Han
// character and, for a Hangul word, there is exactly one per syllable
// (the app's learning.IsCharacterOrigin).
export function isCharacterOrigin(note: {
  word: string
  chars: { char: string }[]
}): boolean {
  if (!note.chars.length) return false
  if (!note.chars.every(({ char }) => /^\p{Script=Han}$/u.test(char)))
    return false
  const hangul = [...note.word].filter((c) => /\p{Script=Hangul}/u.test(c))
  return !hangul.length || hangul.length === note.chars.length
}
