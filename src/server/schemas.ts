import { z } from 'zod'

// All fields are required: these schemas are passed to AI SDK `Output.object`
// for strict final validation. "Not applicable" is an empty string / empty
// array, never a missing key — so no `.optional()` / `.default()` here.

const LearningTips = z
  .object({
    grammar: z
      .string()
      .describe(
        'One or two short sentences (in the metadata language — see prompt) on a useful grammar/structure point from the translation — tense/mood, particle, verb ending, honorific, inversion, clitic placement, gender agreement, word-order quirk, etc. Empty string when nothing genuinely illuminating.',
      ),
    vocab: z
      .string()
      .describe(
        'One or two short sentences (in the metadata language — see prompt) on a notable word choice, idiom, slang, false friend, cognate, regional variant, or cultural connotation that a literal gloss would miss. Empty string when not useful.',
      ),
    characters: z
      .array(
        z.object({
          word: z
            .string()
            .describe(
              'The CJK word as it appears in its native script — Hangul for Korean (e.g. 도서관), mixed kanji/kana for Japanese (e.g. 図書館), Hanzi for Chinese (e.g. 图书馆).',
            ),
          chars: z
            .array(
              z.object({
                char: z.string().describe('A single CJK character, e.g. 書.'),
                meaning: z
                  .string()
                  .describe(
                    'Short gloss in the metadata language — see prompt.',
                  ),
              }),
            )
            .max(10)
            .describe('The character breakdown in order.'),
        }),
      )
      .max(3)
      .describe(
        '0-3 CJK-character words worth breaking down for a learner. Populate ONLY when source or target is Korean (Sino-Korean hanja), Japanese (kanji), or Chinese (hanzi). Skip purely native words (고유어, 和語) and loanwords. Empty array for non-CJK pairs.',
      ),
  })
  .describe(
    'Compact learning aid rendered as "Learning tips". Populate when the language pair involves a language the user does not speak natively — give a useful grammar/structure point and any notable vocab/idiom/cultural note. Leave fields empty individually when there is nothing substantive to say.',
  )
export type LearningTips = z.infer<typeof LearningTips>

const UsedLang = z.enum(['en', 'ko', 'ja', 'fr', 'es', 'zh', 'other'])

export const SentenceResult = z.object({
  sourceLang: UsedLang.describe(
    'The actual language of the source text. When the instructions name a forced source language, echo its code. Otherwise report the language you detected. Use "other" only when the language is not in this list.',
  ),
  targetLang: UsedLang.describe(
    'The language `main` and every alternative are actually written in.',
  ),
  main: z.string().describe('The primary translation of the source text.'),
  rationale: z
    .string()
    .describe(
      'One sentence in the metadata language (see prompt) explaining the chosen translation — highlight wordplay, idioms, slang origins, cultural connotations, or nuance a literal translation would miss. Avoid generic tone descriptions.',
    ),
  alternatives: z
    .array(
      z.object({
        text: z.string(),
        note: z
          .string()
          .describe(
            'Insightful note in the metadata language (see prompt) — explain wordplay, double meanings, slang origins, cultural connotations, or nuance that a literal translation would miss. Avoid generic register descriptions like "casual" or "informal" without further insight.',
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
  learningTips: LearningTips,
})
export type SentenceResult = z.infer<typeof SentenceResult>

const Sense = z.object({
  definition: z
    .string()
    .describe('One-sentence definition in the metadata language (see prompt).'),
  register: z
    .array(z.string())
    .describe(
      'Tags like "informal", "formal", "technical", "slang", "archaic" — written in the metadata language (see prompt). Empty array when none apply.',
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
      'One short sentence in the metadata language (see prompt) on the register/context of primaryTranslation. When there is an important opposite-register equivalent, mention it briefly (e.g., "Casual — for professional settings use 감사합니다."). Empty string when nothing worth noting.',
    ),

  alternativeTranslations: z
    .array(
      z.object({
        text: z.string(),
        register: z
          .array(z.string())
          .describe(
            'Tags (in the metadata language — see prompt) strictly within the current mode band (e.g., ["casual polite"], ["very formal"]). Never cross bands. Empty array when none apply.',
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
      'Usage notes, false friends, common collocations, in the metadata language (see prompt). Empty string when none worth noting.',
    ),

  learningTips: LearningTips,
})
export type WordResult = z.infer<typeof WordResult>
