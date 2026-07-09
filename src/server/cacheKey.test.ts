import { describe, expect, it } from 'vitest'
import { cacheKeyFor } from './cacheKey'

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

describe('cacheKeyFor', () => {
  it('differs when context differs', () => {
    expect(cacheKeyFor(base)).not.toBe(cacheKeyFor({ ...base, context: 'hi' }))
  })

  it('trims context and text', () => {
    expect(
      cacheKeyFor({ ...base, context: ' hi ', text: ' see you tomorrow ' }),
    ).toBe(cacheKeyFor({ ...base, context: 'hi' }))
  })

  it('differs when refinements differ (sentence)', () => {
    expect(cacheKeyFor(base)).not.toBe(
      cacheKeyFor({ ...base, refinements: ['make it softer'] }),
    )
  })

  it('differs when previousMain differs (sentence)', () => {
    expect(
      cacheKeyFor({ ...base, refinements: ['x'], previousMain: 'a' }),
    ).not.toBe(cacheKeyFor({ ...base, refinements: ['x'], previousMain: 'b' }))
  })

  it('ignores refinements and previousMain for word intent', () => {
    const word = { ...base, intent: 'word' as const, text: '배' }
    expect(cacheKeyFor(word)).toBe(
      cacheKeyFor({ ...word, refinements: ['x'], previousMain: 'y' }),
    )
  })

  it('word intent still varies by context', () => {
    const word = { ...base, intent: 'word' as const, text: '배' }
    expect(cacheKeyFor(word)).not.toBe(
      cacheKeyFor({ ...word, context: '배 타고 왔어' }),
    )
  })
})
