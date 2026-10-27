import { expect, it, vi } from 'vitest'
import { handleLearning } from './learning.server'
import { LRU } from './cache'
import type { LearningResult } from './learningTypes'

const input = {
  text: 'Hello',
  translation: '안녕',
  sentenceStart: 0,
  sentenceEnd: 2,
  source: 'en',
  target: 'ko',
  mode: 'casual' as const,
  uiLang: 'en' as const,
  context: '',
}
const output = {
  wordOrder: '',
  chunks: [
    {
      start: 0,
      end: 2,
      text: '안녕',
      sourceSpans: [{ start: 0, end: 5, text: 'Hello' }],
      gloss: 'hello',
      baseForm: '',
      literalMeaning: '',
      naturalMeaning: '',
      grammar: '',
      omissions: '',
    },
  ],
}
const runtime = () => ({
  generate: vi.fn(async () => ({ output })),
  cache: new LRU<string, LearningResult>(50),
  model: 'test/model',
})

it('returns validated analysis and reuses only identical completed inputs', async () => {
  const deps = runtime()
  const signal = new AbortController().signal
  expect((await handleLearning(input, signal, deps)).chunks[0]?.gloss).toBe(
    'hello',
  )
  await handleLearning(input, signal, deps)
  expect(deps.generate).toHaveBeenCalledTimes(1)
  await handleLearning({ ...input, context: 'a friend' }, signal, deps)
  expect(deps.generate).toHaveBeenCalledTimes(2)
  await handleLearning(input, signal, { ...deps, model: 'other/model' })
  expect(deps.generate).toHaveBeenCalledTimes(3)
})
it('bounds generation and disables globally registered content telemetry', async () => {
  const deps = runtime()
  const signal = new AbortController().signal
  await handleLearning(input, signal, deps)
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'test/model',
      maxRetries: 0,
      timeout: 60_000,
      abortSignal: signal,
      telemetry: {
        isEnabled: false,
        recordInputs: false,
        recordOutputs: false,
      },
    }),
  )
})
it('sanitizes provider errors and never automatically retries or caches failure', async () => {
  const deps = runtime()
  deps.generate.mockRejectedValueOnce(
    new Error('SECRET Hello raw provider body'),
  )
  await expect(
    handleLearning(input, new AbortController().signal, deps),
  ).rejects.toThrow('Translation failed')
  expect(deps.generate).toHaveBeenCalledTimes(1)
  expect(
    (await handleLearning(input, new AbortController().signal, deps)).partial,
  ).toBe(false)
  expect(deps.generate).toHaveBeenCalledTimes(2)
})
it('rejects model spans that refer to different text', async () => {
  const deps = runtime()
  deps.generate.mockResolvedValueOnce({
    output: { ...output, chunks: [{ ...output.chunks[0]!, text: '다른 말' }] },
  })
  await expect(
    handleLearning(input, new AbortController().signal, deps),
  ).rejects.toThrow()
  expect(deps.cache.get('anything')).toBeUndefined()
  await handleLearning(input, new AbortController().signal, deps)
  expect(deps.generate).toHaveBeenCalledTimes(2)
})
it('does not start or cache generation after cancellation', async () => {
  const deps = runtime()
  const controller = new AbortController()
  controller.abort()
  await expect(handleLearning(input, controller.signal, deps)).rejects.toThrow()
  expect(deps.generate).not.toHaveBeenCalled()
})
