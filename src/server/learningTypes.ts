import { z } from 'zod'
import { MAX_CONTEXT_CHARS, MAX_INPUT_CHARS } from '../lib/limits'

export const MAX_LEARNING_TRANSLATION_CHARS = 16_000
export const CharacterBreakdown = z.object({
  word: z
    .string()
    .describe(
      'The exact CJK word in the analysed language: Hangul, Japanese or Hanzi.',
    ),
  chars: z
    .array(
      z.object({
        char: z.string().describe('One hanja, kanji or hanzi character.'),
        meaning: z.string().describe('Short meaning in the metadata language.'),
      }),
    )
    .max(10),
})
export type CharacterBreakdownData = z.infer<typeof CharacterBreakdown>
export const LearningPhrase = z.object({
  text: z.string().min(1).max(MAX_LEARNING_TRANSLATION_CHARS),
  gloss: z.string().max(600),
  sourceTexts: z.array(z.string().min(1).max(4000)).max(8),
  baseForm: z.string().max(600),
  literalMeaning: z.string().max(600),
  naturalMeaning: z.string().max(600),
  grammar: z.string().max(1000),
  omissions: z.string().max(600),
  usageNote: z
    .string()
    .max(1000)
    .describe(
      'Useful vocabulary, idiom, register or cultural nuance belonging to this phrase. Empty when redundant.',
    ),
  characters: z
    .array(CharacterBreakdown)
    .max(3)
    .describe(
      'Useful CJK character origins belonging to this exact phrase. Skip native words and loanwords; [] when inapplicable.',
    ),
  grammarHighlights: z
    .array(z.string().min(1).max(4000))
    .max(4)
    .describe(
      'Exact short quotations from this phrase worth underlining for grammar: an ending, particle, conjugation or meaningful grammatical construction. Usually zero or one; use [] for ordinary vocabulary. Never underline every word or quote a whole phrase just to mark it as clickable.',
    ),
})
export const LearningPhrases = z.array(LearningPhrase).max(64)
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
