import { z } from 'zod'
import { CharacterBreakdown, LearningPhrases } from './learningTypes'

// All fields are required: these schemas are passed to AI SDK `Output.object`
// for strict final validation. "Not applicable" is an empty string / empty
// array, never a missing key: so no `.optional()` / `.default()` here.

const UsedLang = z.enum(['en', 'ko', 'ja', 'fr', 'es', 'zh', 'other'])

export const SentenceResult = z.object({
  sourceLang: UsedLang.describe(
    'The actual language of the source text. When the instructions name a forced source language, echo its code. Otherwise report the language you detected. Use "other" only when the language is not in this list.',
  ),
  targetLang: UsedLang.describe(
    'The language `main` and every alternative are actually written in.',
  ),
  main: z.string().describe('The primary translation of the source text.'),
  learningPhrases: LearningPhrases.describe(
    'Complete concise phrase details from this same translation request. If targetLang is the UI language and sourceLang differs, quote original source phrases in source order; sourceTexts quotes their counterparts from main. Otherwise quote main in target order and sourceTexts quotes the original source. Supply a short gloss, dictionary/base form where useful, literal and natural meaning, grammatical construction and implicit content; use empty strings for inapplicable facts. Explanations use the metadata language; baseForm keeps the analysed language. grammarHighlights contains only exact short grammar/conjugation quotations worth underlining, usually [] or one quotation, never every word. Cover meaningful text in natural units, never punctuation-only chunks. No offsets or rewriting. Generate main first so it can be copied while these details stream.',
  ),
  rationale: z
    .string()
    .describe(
      'One sentence in the metadata language (see prompt) explaining the chosen translation: highlight wordplay, idioms, slang origins, cultural connotations, or nuance a literal translation would miss. Avoid generic tone descriptions.',
    ),
  alternatives: z
    .array(
      z.object({
        text: z.string(),
        note: z
          .string()
          .describe(
            'Insightful note in the metadata language (see prompt): explain wordplay, double meanings, slang origins, cultural connotations, or nuance that a literal translation would miss. Avoid generic register descriptions like "casual" or "informal" without further insight.',
          ),
      }),
    )
    .max(6)
    .describe(
      '0-6 alternative phrasings. Leave empty if the source is unambiguous.',
    ),
  formalityNote: z
    .string()
    .describe(
      'Populate when the target language is Korean and the relationship between speakers materially affects the translation (honorific vs. plain). Brief, in the metadata language (see prompt). Empty string when not relevant.',
    ),
})
export type SentenceResult = z.infer<typeof SentenceResult>

const Sense = z.object({
  definition: z
    .string()
    .describe('One-sentence definition in the metadata language (see prompt).'),
  register: z
    .array(z.string())
    .describe(
      'Tags like "informal", "formal", "technical", "slang", "archaic": written in the metadata language (see prompt). Empty array when none apply.',
    ),
  examples: z
    .array(z.string())
    .max(2)
    .describe(
      "Up to 2 short example sentences demonstrating this sense. Write them in the HEADWORD's language so the user sees natural native usage. If the headword's language differs from the metadata language (see prompt), append a metadata-language gloss in parentheses, e.g. \"그는 진짜 빵돌이라서 매일 빵집에 가요. (He's a real bread-lover...)\" when metadata is English.",
    ),
})

export const WordResult = z.object({
  sourceLang: UsedLang.describe(
    'The actual language of the source text. When the instructions name a forced source language, echo its code. Otherwise report the language you detected. Use "other" only when the language is not in this list.',
  ),
  targetLang: UsedLang.describe(
    'The language `primaryTranslation` and every alternative are actually written in.',
  ),
  headword: z.string().describe('The source word, normalized (lemma form).'),

  primaryTranslation: z
    .string()
    .describe(
      'The single most common equivalent in the target language, within the current mode register band.',
    ),

  primaryUsageNote: z
    .string()
    .describe(
      'One short sentence in the metadata language (see prompt) on the register/context of primaryTranslation. When there is an important opposite-register equivalent, mention it briefly (e.g., "Casual: for professional settings use 감사합니다."). Empty string when nothing worth noting.',
    ),

  alternativeTranslations: z
    .array(
      z.object({
        text: z.string(),
        register: z
          .array(z.string())
          .describe(
            'Tags (in the metadata language: see prompt) strictly within the current mode band (e.g., ["casual polite"], ["very formal"]). Never cross bands. Empty array when none apply.',
          ),
        note: z
          .string()
          .describe(
            'Short note in the metadata language (see prompt) on when/why to pick this over the primary.',
          ),
      }),
    )
    .max(4)
    .describe(
      '0-4 alternative equivalents, ALL within the current mode band. Casual mode → casual variants only; Professional → polite/formal only. Never mix bands.',
    ),

  posList: z
    .array(
      z.object({
        pos: z
          .string()
          .describe(
            'Part of speech in the metadata language (see prompt), e.g. "noun", "verb", "adjective", "interjection".',
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

  synonyms: z
    .array(z.string())
    .max(6)
    .describe(
      '3-6 source-language synonyms of the headword when common synonyms exist. Empty array for bare function words.',
    ),

  etymology: z
    .string()
    .describe(
      'Brief etymology when genuinely illuminating, in the metadata language (see prompt). Empty string when not illuminating.',
    ),

  notes: z
    .string()
    .describe(
      'Vocabulary nuance, idioms, cultural context, usage notes, false friends and common collocations, in the metadata language (see prompt). Empty string when none worth noting.',
    ),

  grammar: z
    .string()
    .describe(
      'Useful grammar, inflection or construction for the non-fluent language in this entry, in the metadata language. Empty if unhelpful. Do not duplicate notes.',
    ),
  characters: z
    .array(CharacterBreakdown)
    .max(3)
    .describe(
      'Useful character origins from the non-fluent language in this entry. Skip native words and loanwords; [] when inapplicable.',
    ),
})
export type WordResult = z.infer<typeof WordResult>
