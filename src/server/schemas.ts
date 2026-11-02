import { z } from 'zod'
import sentenceSchema from '../../shared/translation/schemas/sentence.json'
import wordSchema from '../../shared/translation/schemas/word.json'
import type {
  SentenceResultData,
  WordResultData,
} from './resultTypes.generated'

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

/** Strict zod validator for (part of) a shared JSON Schema, typed as `T`. */
export function fromSharedSchema<T>(schema: object): z.ZodType<T> {
  return z.fromJSONSchema(schema as JSONSchemaInput) as z.ZodType<T>
}

export const SENTENCE_RESULT_SCHEMA = sentenceSchema
export const WORD_RESULT_SCHEMA = wordSchema

export const SentenceResult = fromSharedSchema<SentenceResultData>(
  SENTENCE_RESULT_SCHEMA,
)
export type SentenceResult = SentenceResultData

export const WordResult = fromSharedSchema<WordResultData>(WORD_RESULT_SCHEMA)
export type WordResult = WordResultData
