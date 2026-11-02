import { z } from 'zod'
import sentenceSchema from '../../shared/translation/schemas/sentence.json'
import wordSchema from '../../shared/translation/schemas/word.json'
import type {
  CharacterBreakdownData,
  LearningPhraseData,
  SentenceResultData,
  WordResultData,
} from './resultTypes.generated'

// SERVER-ONLY at runtime: client code may import types from this module, never
// values (the JSON Schemas carry ~14 KB of prompt-text descriptions).
// Client-safe learning validators live in ./learningTypes.
//
// The strict result JSON Schemas live in shared/translation/schemas/ (their
// descriptions are prompt text the model reads) and are shared with the Go
// app. All fields are required: these schemas are passed to AI SDK
// `Output.object` for strict final validation. "Not applicable" is an empty
// string / empty array, never a missing key.
//
// z.fromJSONSchema converts back to the identical request schema (proved by
// the golden request bodies) and validates strictly; static types come from
// json-schema-to-typescript (`npm run shared:generate`).

type JSONSchemaInput = Parameters<typeof z.fromJSONSchema>[0]

/**
 * Strict zod validator for (part of) a shared JSON Schema, typed as `T`.
 * Annotated side-effect free so bundlers drop unused validators (and their
 * schema JSON) from bundles that reach this module only through server
 * functions, such as the client build of translate.ts.
 */
/* @__NO_SIDE_EFFECTS__ */
export function fromSharedSchema<T>(schema: object): z.ZodType<T> {
  return z.fromJSONSchema(schema as JSONSchemaInput) as z.ZodType<T>
}

type SentenceSchema = typeof sentenceSchema
type PhraseSchema = SentenceSchema['properties']['learningPhrases']

/* @__NO_SIDE_EFFECTS__ */
function fromSentencePart<T>(
  part: (schema: PhraseSchema) => object,
): z.ZodType<T> {
  // The property walk happens inside this function so an unused validator
  // leaves no top-level property access that would keep the schema JSON.
  return fromSharedSchema<T>(part(sentenceSchema.properties.learningPhrases))
}

export const SENTENCE_RESULT_SCHEMA = sentenceSchema
export const WORD_RESULT_SCHEMA = wordSchema

export const SentenceResult =
  /* @__PURE__ */ fromSharedSchema<SentenceResultData>(SENTENCE_RESULT_SCHEMA)
export type SentenceResult = SentenceResultData

export const WordResult =
  /* @__PURE__ */ fromSharedSchema<WordResultData>(WORD_RESULT_SCHEMA)
export type WordResult = WordResultData

// Strict phrase and character parts of the sentence result schema.
export const LearningPhrases = /* @__PURE__ */ fromSentencePart<
  LearningPhraseData[]
>((phrases) => phrases)
export const LearningPhrase =
  /* @__PURE__ */ fromSentencePart<LearningPhraseData>(
    (phrases) => phrases.items,
  )
export const CharacterBreakdown =
  /* @__PURE__ */ fromSentencePart<CharacterBreakdownData>(
    (phrases) => phrases.items.properties.characters.items,
  )
