import { z } from 'zod'
import {
  MAX_CONTEXT_CHARS,
  MAX_INPUT_CHARS,
  MAX_REFINEMENT_CHARS,
  MAX_REFINEMENTS,
} from '../lib/limits'

export const TranslateInput = z.object({
  text: z.string().min(1).max(MAX_INPUT_CHARS),
  source: z.string(),
  target: z.string(),
  mode: z.enum(['friends', 'casual', 'professional']),
  intent: z.enum(['word', 'sentence']),
  uiLang: z.enum(['en', 'ko']).default('en'),
  context: z.string().max(MAX_CONTEXT_CHARS).default(''),
  refinements: z
    .array(z.string().min(1).max(MAX_REFINEMENT_CHARS))
    .max(MAX_REFINEMENTS)
    .default([]),
  previousMain: z.string().max(MAX_INPUT_CHARS).default(''),
  analyticsSessionId: z.uuid().optional(),
  analyticsRunId: z.uuid().optional(),
  analyticsSupersedesRunId: z.uuid().optional(),
  analyticsInputRevision: z.number().int().nonnegative().optional(),
  analyticsTrigger: z
    .enum(['debounce', 'paste', 'enter', 'blur', 'force', 'refinement'])
    .default('debounce'),
})

export type TranslateInputData = z.infer<typeof TranslateInput>
