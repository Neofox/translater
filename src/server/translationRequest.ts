import { Output } from 'ai'
import { CACHE_VERSION, promptCacheKeyFor } from './cacheKey'
import { gatewayProviderOptions, gatewayTags } from './gateway'
import { sentencePrompt, wordPrompt } from './prompts'
import type { SentenceSystemContext } from './prompts'
import { SentenceResult, WordResult } from './schemas'
import type { TranslateInputData } from './translateTypes'

export type TranslationRequestKind = 'initial' | 'context' | 'refinement'

export function translationRequestKind(
  data: Pick<TranslateInputData, 'refinements' | 'context'>,
): TranslationRequestKind {
  return data.refinements.length > 0
    ? 'refinement'
    : data.context
      ? 'context'
      : 'initial'
}

// The model-facing part of a translation call, shared by the server function,
// smoke scripts and quality evals so they all measure the production request.
export function translationRequest(
  data: TranslateInputData,
  model: string,
  // Evals only: try alternative sentence instructions on the same request.
  sentenceSystem?: (ctx: SentenceSystemContext) => string,
) {
  const isWord = data.intent === 'word'
  const prompt = isWord
    ? wordPrompt(data)
    : sentencePrompt(data, sentenceSystem)
  return {
    model,
    instructions: prompt.instructions,
    messages: prompt.messages,
    output: isWord
      ? Output.object({ schema: WordResult, name: 'word_translation' })
      : Output.object({ schema: SentenceResult, name: 'sentence_translation' }),
    maxRetries: 0,
    // Portable across Gateway models: hidden reasoning delays the first token
    // by seconds and is billed as output.
    reasoning: 'none' as const,
    providerOptions: gatewayProviderOptions({
      model,
      promptCacheKey: promptCacheKeyFor(data),
      tags: gatewayTags({
        intent: data.intent,
        requestKind: translationRequestKind(data),
        promptVersion: CACHE_VERSION,
      }),
    }),
  }
}
