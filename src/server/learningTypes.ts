import { z } from 'zod'
import { SENTENCE_RESULT_SCHEMA, fromSharedSchema } from './schemas'
import {
  MAX_CONTEXT_CHARS,
  MAX_INPUT_CHARS,
  MAX_LEARNING_TRANSLATION_CHARS,
} from '../lib/limits'
import type {
  CharacterBreakdownData,
  LearningPhraseData,
} from './resultTypes.generated'

export { MAX_LEARNING_TRANSLATION_CHARS }
export type { CharacterBreakdownData, LearningPhraseData }

// Phrase and character parts of the shared sentence result schema
// (shared/translation/schemas/sentence.json), validated by zod.
const learningPhrasesSchema = SENTENCE_RESULT_SCHEMA.properties.learningPhrases
const phraseSchema = learningPhrasesSchema.items
const characterSchema = phraseSchema.properties.characters.items

export const CharacterBreakdown =
  fromSharedSchema<CharacterBreakdownData>(characterSchema)
export const LearningPhrase = fromSharedSchema<LearningPhraseData>(phraseSchema)
export const LearningPhrases = fromSharedSchema<LearningPhraseData[]>(
  learningPhrasesSchema,
)

// Page-memory compatibility only: older gloss-only results may lack every
// detail field, and (as with the earlier non-strict zod objects) unknown keys
// do not reject the map. The generated schema still requires all fields.
const LEGACY_PHRASE_REQUIRED = ['text', 'gloss', 'sourceTexts']
function lenient(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(lenient)
  if (!schema || typeof schema !== 'object') return schema
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== 'additionalProperties')
      .map(([key, value]) => [key, lenient(value)]),
  )
}
export type LegacyLearningPhraseData = Pick<
  LearningPhraseData,
  'text' | 'gloss' | 'sourceTexts'
> &
  Partial<LearningPhraseData>
export const LegacyLearningPhrases = fromSharedSchema<
  LegacyLearningPhraseData[]
>(
  lenient({
    ...learningPhrasesSchema,
    items: { ...phraseSchema, required: LEGACY_PHRASE_REQUIRED },
  }) as object,
)
export const LearningInput = z
  .object({
    text: z.string().min(1).max(MAX_INPUT_CHARS),
    translation: z.string().min(1).max(MAX_LEARNING_TRANSLATION_CHARS),
    sentenceStart: z.number().int().nonnegative(),
    sentenceEnd: z.number().int().positive(),
    source: z.string().min(1).max(20),
    target: z.string().min(1).max(20),
    mode: z.enum(['friends', 'casual', 'professional']),
    uiLang: z.enum(['en', 'ko']),
    context: z.string().max(MAX_CONTEXT_CHARS),
    // Omitted by legacy clients: their analysed text is the target translation.
    side: z.enum(['source', 'target']).optional(),
  })
  .refine(
    (v) =>
      v.sentenceStart < v.sentenceEnd &&
      v.sentenceEnd <=
        (v.side === 'source' ? v.text.length : v.translation.length),
    'Invalid sentence range',
  )

const Span = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string().min(1).max(MAX_LEARNING_TRANSLATION_CHARS),
})
export const LearningOutput = z.object({
  wordOrder: z.string().max(1600),
  chunks: z
    .array(
      Span.extend({
        sourceSpans: z.array(Span).max(8),
        gloss: z.string().max(600),
        baseForm: z.string().max(600),
        literalMeaning: z.string().max(600),
        naturalMeaning: z.string().max(600),
        grammar: z.string().max(1000),
        omissions: z.string().max(600),
      }),
    )
    .min(1)
    .max(64),
})
export type LearningInputData = z.infer<typeof LearningInput>
export type LearningChunk = z.infer<typeof LearningOutput>['chunks'][number] & {
  grammarHighlights?: { start: number; end: number }[]
  usageNote?: string
  characters?: CharacterBreakdownData[]
}
export type LearningResult = Omit<z.infer<typeof LearningOutput>, 'chunks'> & {
  chunks: LearningChunk[]
  partial: boolean
}
