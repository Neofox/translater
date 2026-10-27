import { describe, expect, it } from 'vitest'
import { sentenceRanges, validateLearningResult } from './learningRanges'

const input = {
  text: 'Thanks for helping me today.',
  translation: '오늘 도와줘서 고마워요.',
  sentenceStart: 0,
  sentenceEnd: 13,
  source: 'en',
  target: 'ko',
  mode: 'casual' as const,
  uiLang: 'en' as const,
  context: '',
}
const fact = {
  gloss: 'for helping me',
  baseForm: '도와주다',
  literalMeaning: 'because you helped',
  naturalMeaning: 'for helping me',
  grammar: '-어서 gives the reason',
  omissions: 'you and me are implicit',
}
const chunks = [
  {
    ...fact,
    start: 0,
    end: 2,
    text: '오늘',
    sourceSpans: [{ start: 22, end: 27, text: 'today' }],
  },
  {
    ...fact,
    start: 3,
    end: 7,
    text: '도와줘서',
    sourceSpans: [{ start: 7, end: 21, text: 'for helping me' }],
  },
  {
    ...fact,
    start: 8,
    end: 12,
    text: '고마워요',
    sourceSpans: [{ start: 0, end: 6, text: 'Thanks' }],
  },
]
describe('validated learning spans', () => {
  it('keeps exact target text with reordered source correspondence', () => {
    const result = validateLearningResult(input, {
      wordOrder: 'Thanks comes last.',
      chunks,
    })
    expect(result.partial).toBe(false)
    expect(result.chunks[1]?.sourceSpans).toEqual([
      { start: 7, end: 21, text: 'for helping me' },
    ])
    expect(result.chunks.map((c) => c.text)).toEqual([
      '오늘',
      '도와줘서',
      '고마워요',
    ])
  })
  it('allows omitted source spans and labels incomplete target coverage', () => {
    expect(
      validateLearningResult(input, {
        wordOrder: '',
        chunks: [{ ...chunks[1], sourceSpans: [] }],
      }).partial,
    ).toBe(true)
  })
  it.each([
    { ...chunks[0], end: 3 },
    { ...chunks[0], start: -1 },
    { ...chunks[0], sourceSpans: [{ start: 0, end: 5, text: 'today' }] },
    { ...chunks[0], sourceSpans: [{ start: 999, end: 1000, text: 'x' }] },
  ])('rejects a range that does not identify its exact text', (bad) => {
    expect(() =>
      validateLearningResult(input, { wordOrder: '', chunks: [bad] }),
    ).toThrow()
  })
  it('rejects overlapping target chunks', () => {
    expect(() =>
      validateLearningResult(input, {
        wordOrder: '',
        chunks: [chunks[0], chunks[0]],
      }),
    ).toThrow()
  })
  it('does not split emoji or combining-character graphemes', () => {
    const unicode = { ...input, translation: '😀 é', sentenceEnd: 5 }
    expect(() =>
      validateLearningResult(unicode, {
        wordOrder: '',
        chunks: [{ ...chunks[0], start: 0, end: 1, text: '\ud83d' }],
      }),
    ).toThrow()
    expect(() =>
      validateLearningResult(unicode, {
        wordOrder: '',
        chunks: [{ ...chunks[0], start: 3, end: 4, text: 'e' }],
      }),
    ).toThrow()
  })
  it('distinguishes repeated source occurrences by exact offset', () => {
    const repeated = { ...input, text: 'go go' }
    const result = validateLearningResult(repeated, {
      wordOrder: '',
      chunks: [
        { ...chunks[0], sourceSpans: [{ start: 3, end: 5, text: 'go' }] },
      ],
    })
    expect(result.chunks[0]?.sourceSpans[0]?.start).toBe(3)
  })
  it('returns exact sentence slices including original whitespace and newlines', () => {
    const text = 'Hello!\n오늘 어때요?'
    expect(
      sentenceRanges(text, 'ko').map((r) => text.slice(r.start, r.end)),
    ).toEqual(['Hello!\n', '오늘 어때요?'])
  })
})
