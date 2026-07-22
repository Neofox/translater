import { describe, expect, it } from 'vitest'
import { cacheKeyFor, promptCacheKeyFor } from './cacheKey'

const base = {
  intent: 'sentence' as const,
  mode: 'casual' as const,
  source: 'en',
  target: 'ko',
  uiLang: 'en',
  text: 'see you tomorrow',
  context: '',
  refinements: [] as string[],
  previousMain: '',
}

const model = 'openai/gpt-5.6-luna'

describe('cacheKeyFor', () => {
  it('differs when context differs', () => {
    expect(cacheKeyFor(base, model)).not.toBe(
      cacheKeyFor({ ...base, context: 'hi' }, model),
    )
  })

  it('trims context and text', () => {
    expect(
      cacheKeyFor(
        { ...base, context: ' hi ', text: ' see you tomorrow ' },
        model,
      ),
    ).toBe(cacheKeyFor({ ...base, context: 'hi' }, model))
  })

  it('differs when refinements differ (sentence)', () => {
    expect(cacheKeyFor(base, model)).not.toBe(
      cacheKeyFor({ ...base, refinements: ['make it softer'] }, model),
    )
  })

  it('differs when previousMain differs (sentence)', () => {
    expect(
      cacheKeyFor({ ...base, refinements: ['x'], previousMain: 'a' }, model),
    ).not.toBe(
      cacheKeyFor({ ...base, refinements: ['x'], previousMain: 'b' }, model),
    )
  })

  it('ignores refinements and previousMain for word intent', () => {
    const word = { ...base, intent: 'word' as const, text: '배' }
    expect(cacheKeyFor(word, model)).toBe(
      cacheKeyFor({ ...word, refinements: ['x'], previousMain: 'y' }, model),
    )
  })

  it('word intent still varies by context', () => {
    const word = { ...base, intent: 'word' as const, text: '배' }
    expect(cacheKeyFor(word, model)).not.toBe(
      cacheKeyFor({ ...word, context: '배 타고 왔어' }, model),
    )
  })

  it('ignores a stale previousMain once refinements is empty', () => {
    expect(
      cacheKeyFor({ ...base, refinements: [], previousMain: 'x' }, model),
    ).toBe(cacheKeyFor(base, model))
  })

  it('differs when the exact deployment model differs', () => {
    expect(cacheKeyFor(base, 'openai/gpt-5.6-luna')).not.toBe(
      cacheKeyFor(base, 'anthropic/claude-sonnet-4.5'),
    )
  })
})

describe('promptCacheKeyFor', () => {
  it('varies for every field that changes the reusable prompt prefix', () => {
    const key = promptCacheKeyFor(base)
    expect(promptCacheKeyFor({ ...base, intent: 'word' })).not.toBe(key)
    expect(promptCacheKeyFor({ ...base, mode: 'professional' })).not.toBe(key)
    expect(promptCacheKeyFor({ ...base, source: 'auto' })).not.toBe(key)
    expect(promptCacheKeyFor({ ...base, target: 'ja' })).not.toBe(key)
    expect(promptCacheKeyFor({ ...base, uiLang: 'ko' })).not.toBe(key)
  })

  it('ignores live input that appears after the cache breakpoint', () => {
    const changedLiveInput = {
      ...base,
      text: 'different source',
      context: 'different context',
      refinements: ['shorter'],
      previousMain: 'old output',
    }
    expect(promptCacheKeyFor(base)).toBe(promptCacheKeyFor(changedLiveInput))
  })
})
