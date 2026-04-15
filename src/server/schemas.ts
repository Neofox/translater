import { z } from 'zod'

export const SentenceResult = z.object({
  main: z.string().describe('The primary translation of the source text.'),
  rationale: z
    .string()
    .describe(
      'One English sentence explaining the chosen translation — highlight wordplay, idioms, slang origins, cultural connotations, or nuance a literal translation would miss. Avoid generic tone descriptions. ALWAYS in English.',
    ),
  alternatives: z
    .array(
      z.object({
        text: z.string(),
        note: z
          .string()
          .describe(
            'Insightful English note — explain wordplay, double meanings, slang origins, cultural connotations, or nuance that a literal translation would miss. Avoid generic register descriptions like "casual" or "informal" without further insight.',
          ),
      }),
    )
    .max(7)
    .describe(
      '0-6 alternative phrasings. Leave empty if the source is unambiguous.',
    ),
  formalityNote: z
    .string()
    .default('')
    .describe(
      'Populate when the target language is Korean and the relationship between speakers materially affects the translation (honorific vs. plain). Brief, ENGLISH. Empty string when not relevant.',
    ),
})
export type SentenceResult = z.infer<typeof SentenceResult>

const Sense = z.object({
  definition: z
    .string()
    .describe(
      'One-sentence definition IN ENGLISH. Always English, never Korean/Japanese/other.',
    ),
  register: z
    .array(z.string())
    .default([])
    .describe(
      'English tags like "informal", "formal", "technical", "slang", "archaic". Empty array when none apply.',
    ),
  examples: z
    .array(z.string())
    .max(2)
    .default([])
    .describe(
      'Up to 2 short example sentences demonstrating this sense. Write them in the HEADWORD\'s language so the user sees natural native usage. If that language is not English, append an English gloss in parentheses, e.g. "그는 진짜 빵돌이라서 매일 빵집에 가요. (He\'s a real bread-lover, so he goes to the bakery every day.)". If the headword is English, the example is plain English.',
    ),
})

export const WordResult = z.object({
  headword: z.string().describe('The source word, normalized (lemma form).'),

  posList: z
    .array(
      z.object({
        pos: z
          .string()
          .describe(
            'Part of speech in English, e.g. "noun", "verb", "adjective", "interjection".',
          ),
        senses: z
          .array(Sense)
          .max(4)
          .describe('1-4 senses ordered by frequency within this POS.'),
      }),
    )
    .max(3)
    .describe(
      '1-3 parts of speech the headword can take, ordered by frequency of use.',
    ),

  primaryTranslation: z
    .string()
    .describe(
      'The single most common equivalent in the target language, within the current mode register band.',
    ),

  primaryUsageNote: z
    .string()
    .default('')
    .describe(
      'One short English sentence on the register/context of primaryTranslation. When there is an important opposite-register equivalent, mention it briefly (e.g., "Casual — for professional settings use 감사합니다."). ALWAYS in English.',
    ),

  alternativeTranslations: z
    .array(
      z.object({
        text: z.string(),
        register: z
          .array(z.string())
          .default([])
          .describe(
            'English tags strictly within the current mode band (e.g., ["casual polite"], ["very formal"]). Never cross bands.',
          ),
        note: z
          .string()
          .describe(
            'Short English note on when/why to pick this over the primary.',
          ),
      }),
    )
    .max(5)
    .default([])
    .describe(
      '0-4 alternative equivalents, ALL within the current mode band. Casual mode → casual variants only; Professional → polite/formal only. Never mix bands.',
    ),

  synonyms: z
    .array(z.string())
    .max(8)
    .default([])
    .describe(
      '3-6 source-language synonyms of the headword when common synonyms exist. Empty array for bare function words.',
    ),

  etymology: z
    .string()
    .default('')
    .describe(
      'Brief etymology when genuinely illuminating. ALWAYS IN ENGLISH — never Korean, Japanese, or any other language. Empty string when not illuminating.',
    ),

  notes: z
    .string()
    .default('')
    .describe(
      'Usage notes, false friends, common collocations. ALWAYS IN ENGLISH — never Korean, Japanese, or any other language. Empty string when none worth noting.',
    ),
})
export type WordResult = z.infer<typeof WordResult>
