import './aiSdkWarnings.server'
import { generateText, Output } from 'ai'
import { LRU } from './cache'
import { gatewayProviderOptions, resolveTranslateModel } from './gateway'
import { learningPrompt, LEARNING_PROMPT_VERSION } from './learningPrompts'
import { LearningInput, LearningOutput } from './learningTypes'
import type { LearningInputData, LearningResult } from './learningTypes'
import { resolveLearningResult } from '../lib/learningRanges'
import {
  classifyTranslationError,
  publicTranslationError,
} from './translationError'

type Dependencies = {
  generate: (
    options: Parameters<typeof generateText>[0],
  ) => Promise<{ output: unknown }>
  cache: Pick<LRU<string, LearningResult>, 'get' | 'set'>
  model: string
}
const completed = new LRU<string, LearningResult>(50)

export async function handleLearning(
  input: LearningInputData,
  signal: AbortSignal,
  dependencies: Partial<Dependencies> = {},
): Promise<LearningResult> {
  const data = LearningInput.parse(input)
  signal.throwIfAborted()
  const {
    generate = generateText,
    cache = completed,
    model = resolveTranslateModel(),
  } = dependencies
  const key = JSON.stringify([LEARNING_PROMPT_VERSION, model, data])
  const cached = cache.get(key)
  if (cached) return cached
  try {
    const { output } = await generate({
      model,
      ...learningPrompt(data),
      output: Output.object({
        schema: LearningOutput,
        name: 'translation_learning',
      }),
      maxRetries: 0,
      maxOutputTokens: 8000,
      timeout: 60_000,
      abortSignal: signal,
      providerOptions: gatewayProviderOptions({
        model,
        promptCacheKey: `${LEARNING_PROMPT_VERSION}:${data.uiLang}`,
        tags: ['learning', LEARNING_PROMPT_VERSION],
      }),
      telemetry: {
        isEnabled: false,
        recordInputs: false,
        recordOutputs: false,
      },
    })
    signal.throwIfAborted()
    let result: LearningResult
    try {
      result = resolveLearningResult(data, output)
    } catch {
      throw publicTranslationError('structured_output', data.uiLang)
    }
    cache.set(key, result)
    return result
  } catch (error) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    // Never expose raw provider bodies, prompts, or validation diagnostics.
    throw publicTranslationError(classifyTranslationError(error), data.uiLang)
  }
}
