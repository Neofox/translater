import { z } from 'zod'
import {
  MAX_CONTEXT_CHARS,
  MAX_INPUT_CHARS,
  MAX_LEARNING_TRANSLATION_CHARS,
} from '../lib/limits'
import type {
  CharacterBreakdownData,
  LearningPhraseData,
} from './resultTypes.generated'

// Client-safe: this module reaches the browser through src/lib/learningRanges.
// Never value-import ./schemas here; the strict result validators (and the
// shared JSON Schemas with their prompt-text descriptions) are server-only.

export { MAX_LEARNING_TRANSLATION_CHARS }
export type { CharacterBreakdownData, LearningPhraseData }

// Page-memory compatibility only: older gloss-only results may lack every
// detail field; unknown keys are stripped. Same fields and bounds as the
// learning phrase in shared/translation/schemas/sentence.json, without its
// descriptions (schemas.test.ts keeps the field set in sync). The strict
// generated schema still requires every field.
const LegacyCharacter = z.object({
  word: z.string(),
  chars: z.array(z.object({ char: z.string(), meaning: z.string() })).max(10),
})
export const LegacyLearningPhrase = z.object({
  text: z.string().min(1).max(MAX_LEARNING_TRANSLATION_CHARS),
  gloss: z.string().max(600),
  sourceTexts: z.array(z.string().min(1).max(4000)).max(8),
  baseForm: z.string().max(600).optional(),
  literalMeaning: z.string().max(600).optional(),
  naturalMeaning: z.string().max(600).optional(),
  grammar: z.string().max(1000).optional(),
  omissions: z.string().max(600).optional(),
  usageNote: z.string().max(1000).optional(),
  characters: z.array(LegacyCharacter).max(3).optional(),
  grammarHighlights: z.array(z.string().min(1).max(4000)).max(4).optional(),
})
export type LegacyLearningPhraseData = z.infer<typeof LegacyLearningPhrase>
export const LegacyLearningPhrases = z.array(LegacyLearningPhrase).max(64)
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
