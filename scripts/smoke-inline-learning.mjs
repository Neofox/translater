import 'dotenv/config'
import '../src/server/aiSdkWarnings.server.ts'
import assert from 'node:assert/strict'
import { Output, streamText } from 'ai'
import { sentencePrompt } from '../src/server/prompts.ts'
import { SentenceResult } from '../src/server/schemas.ts'
import { prepareLearningResult } from '../src/lib/learningRanges.ts'
import { partialParse } from '../src/lib/partialParse.ts'
import { CACHE_VERSION, promptCacheKeyFor } from '../src/server/cacheKey.ts'
import {
  assertGatewayAuthentication,
  gatewayProviderOptions,
  resolveTranslateModel,
} from '../src/server/gateway.ts'
import { classifyTranslationError } from '../src/server/translationError.ts'

// One real, potentially billed translation. Print aggregate checks, never the
// source, generated content, credentials or raw provider errors. No retries.
const args = {
  text: 'Thanks for helping me today.',
  source: 'en',
  target: 'ko',
  mode: 'casual',
  uiLang: 'en',
  intent: 'sentence',
}
try {
  assertGatewayAuthentication()
  const model = resolveTranslateModel()
  const started = Date.now()
  const response = streamText({
    model,
    ...sentencePrompt(args),
    output: Output.object({
      schema: SentenceResult,
      name: 'sentence_translation',
    }),
    maxRetries: 0,
    reasoning: 'none',
    timeout: 60_000,
    providerOptions: gatewayProviderOptions({
      model,
      promptCacheKey: promptCacheKeyFor(args),
      tags: ['translation', CACHE_VERSION, 'inline-learning-smoke'],
    }),
    telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
  })
  let raw = ''
  let mainReadyMs = null
  for await (const delta of response.textStream) {
    raw += delta
    if (mainReadyMs === null && partialParse(raw, false)?.main)
      mainReadyMs = Date.now() - started
  }
  const data = SentenceResult.parse(await response.output)
  const prepared = prepareLearningResult(
    args.text,
    data.main,
    data.learningPhrases,
  )
  const totalMs = Date.now() - started
  assert(prepared?.chunks.length)
  assert(data.learningPhrases.some((p) => p.grammar.trim()))
  assert(mainReadyMs !== null && mainReadyMs < totalMs)
  const highlights = prepared.chunks.flatMap(
    (chunk) => chunk.grammarHighlights ?? [],
  )
  assert(highlights.length > 0)
  assert(
    highlights.reduce((sum, span) => sum + span.end - span.start, 0) <
      data.main.length,
  )
  console.log(
    JSON.stringify({
      model,
      requests: 1,
      schemaValid: true,
      notesOwnedByPhrases:
        data.learningPhrases.every(
          (p) => typeof p.usageNote === 'string' && Array.isArray(p.characters),
        ) && !('learningTips' in data),
      phrases: prepared.chunks.length,
      phrasesWithDetails: prepared.chunks.filter(
        (p) =>
          p.baseForm ||
          p.literalMeaning ||
          p.naturalMeaning ||
          p.grammar ||
          p.omissions,
      ).length,
      grammarHighlights: highlights.length,
      mainReadyMs,
      totalMs,
      copyReadyBeforeDetailsComplete: true,
    }),
  )
} catch (error) {
  console.error(
    JSON.stringify({
      smoke: 'inline-learning',
      failed: true,
      kind: classifyTranslationError(error),
      retried: false,
    }),
  )
  process.exitCode = 1
}
