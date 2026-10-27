import { z } from 'zod'
import { MAX_CONTEXT_CHARS, MAX_INPUT_CHARS } from '../lib/limits'

export const MAX_LEARNING_TRANSLATION_CHARS = 16_000
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
  })
  .refine(
    (v) =>
      v.sentenceStart < v.sentenceEnd && v.sentenceEnd <= v.translation.length,
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
export type LearningChunk = z.infer<typeof LearningOutput>['chunks'][number]
export type LearningResult = z.infer<typeof LearningOutput> & {
  partial: boolean
}
