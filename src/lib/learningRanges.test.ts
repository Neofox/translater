import { describe, expect, it } from 'vitest'
import {
  prepareLearningResult,
  sentenceRanges,
  validateLearningResult,
} from './learningRanges'

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
  it('retains complete phrase details and resolves only quoted grammar highlights', () => {
    const result = prepareLearningResult(input.text, input.translation, [
      {
        text: '오늘',
        ...fact,
        gloss: 'today',
        sourceTexts: ['today'],
        grammarHighlights: [],
      },
      {
        text: '도와줘서',
        ...fact,
        sourceTexts: ['for helping me'],
        grammarHighlights: ['줘서', 'missing'],
      },
      {
        text: '고마워요',
        ...fact,
        gloss: 'thanks',
        sourceTexts: ['Thanks'],
        grammarHighlights: ['요'],
      },
    ])
    expect(result?.chunks[1]).toMatchObject({
      ...fact,
      grammarHighlights: [{ start: 5, end: 7 }],
    })
    expect(result?.chunks[0]?.grammarHighlights).toEqual([])
    expect(result?.chunks[2]?.grammarHighlights).toEqual([
      { start: 11, end: 12 },
    ])
  })

  it('does not underline ambiguous quotes or split a combining-character grapheme', () => {
    const result = prepareLearningResult('', 'banana é', [
      {
        text: 'banana é',
        ...fact,
        sourceTexts: [],
        grammarHighlights: ['a', 'e'],
      },
    ])
    expect(result?.chunks[0]?.grammarHighlights).toEqual([])
  })
  it('requires a grammar explanation before an annotation can be underlined', () => {
    const result = prepareLearningResult('today', '오늘', [
      {
        text: '오늘',
        ...fact,
        grammar: '',
        sourceTexts: ['today'],
        grammarHighlights: ['오늘'],
      },
    ])
    expect(result?.chunks[0]?.grammarHighlights).toEqual([])
  })
  it('validates Korean source chunks against the original when translating into the UI language', () => {
    const reading = {
      ...input,
      text: input.translation,
      translation: 'Thanks.',
      source: 'ko',
      target: 'en',
      side: 'source' as const,
    }
    const result = validateLearningResult(reading, {
      wordOrder: '',
      chunks: chunks.map((chunk) => ({ ...chunk, sourceSpans: [] })),
    })
    expect(result.chunks.map((c) => c.text)).toEqual([
      '오늘',
      '도와줘서',
      '고마워요',
    ])
    expect(result.partial).toBe(false)
  })
  it('prepares exact phrase positions and meanings from the translation response without model-counted offsets', () => {
    const result = prepareLearningResult(input.text, input.translation, [
      { text: '오늘', gloss: 'today', sourceTexts: ['today'] },
      { text: ',', gloss: '', sourceTexts: [] },
      {
        text: '도와줘서',
        gloss: 'for helping me',
        sourceTexts: ['for helping me'],
      },
      { text: '고마워요', gloss: 'thanks', sourceTexts: ['Thanks'] },
    ])
    expect(result?.chunks.map((c) => c.text)).toEqual([
      '오늘',
      '도와줘서',
      '고마워요',
    ])
    expect(result?.chunks[1]).toMatchObject({
      start: 3,
      end: 7,
      gloss: 'for helping me',
      sourceSpans: [{ start: 7, end: 21, text: 'for helping me' }],
    })
  })
  it('uses phrase order to resolve repeated quotes and leaves an ambiguous lone quote unmarked', () => {
    const phrase = { text: 'yes', gloss: 'agreement', sourceTexts: [] }
    expect(
      prepareLearningResult('oui oui', 'yes yes', [phrase, phrase])?.chunks.map(
        (c) => c.start,
      ),
    ).toEqual([0, 4])
    expect(prepareLearningResult('oui oui', 'yes yes', [phrase])).toBeNull()
  })
  it('keeps independent Korean details when model quotations overlap', () => {
    const korean =
      '평면도 작성 기능을 확인해 보실 수 있는 링크를 공유드립니다.\n직접 사용해 보시고, UX 흐름이나 사용성에 관한 의견이 있으시면 편하게 알려 주세요.'
    const result = prepareLearningResult('An English translation.', korean, [
      { ...fact, text: '평면도 작성 기능을', sourceTexts: [] },
      { ...fact, text: '작성 기능을 확인해 보실 수 있는', sourceTexts: [] },
      { ...fact, text: '링크를 공유드립니다', sourceTexts: [] },
      { ...fact, text: '직접 사용해 보시고', sourceTexts: [] },
    ])
    expect(result?.chunks.map((c) => c.text)).toEqual([
      '링크를 공유드립니다',
      '직접 사용해 보시고',
    ])
    expect(result?.partial).toBe(true)
  })
  it('orders uniquely quoted details without inventing positions for ambiguous repeats', () => {
    const result = prepareLearningResult('', 'one yes yes two', [
      { ...fact, text: 'two', sourceTexts: [] },
      { ...fact, text: 'one', sourceTexts: [] },
      { ...fact, text: 'yes', sourceTexts: [] },
    ])
    expect(result?.chunks.map((c) => [c.text, c.start, c.end])).toEqual([
      ['one', 0, 3],
      ['two', 12, 15],
    ])
    expect(result?.partial).toBe(true)
  })
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
