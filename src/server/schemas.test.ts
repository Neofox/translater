import { describe, expect, it } from 'vitest'
import { SentenceResult } from './schemas'

const characterEntry = (char: string) => ({
  word: char,
  chars: [{ char, meaning: char }],
})

const validResult = {
  sourceLang: 'zh',
  targetLang: 'en',
  main: 'School life',
  rationale: 'A direct translation.',
  alternatives: [],
  formalityNote: '',
  learningTips: {
    grammar: '',
    vocab: '',
    characters: ['學', '校', '生'].map(characterEntry),
  },
}

describe('SentenceResult', () => {
  it('accepts a fully populated strict payload', () => {
    const result = SentenceResult.parse(validResult)
    expect(result.learningTips.characters).toHaveLength(3)
  })

  it('rejects more than three character tips (strict schema enforces the cap)', () => {
    const overLimit = {
      ...validResult,
      learningTips: {
        ...validResult.learningTips,
        characters: ['學', '校', '生', '活'].map(characterEntry),
      },
    }
    expect(() => SentenceResult.parse(overLimit)).toThrow()
  })

  it('rejects payloads with missing fields — strict mode means no defaults', () => {
    const { formalityNote: _omitted, ...withoutFormalityNote } = validResult
    expect(() => SentenceResult.parse(withoutFormalityNote)).toThrow()
  })

  it('rejects payloads missing sourceLang/targetLang', () => {
    const { sourceLang: _s, targetLang: _t, ...without } = validResult
    expect(() => SentenceResult.parse(without)).toThrow()
  })

  it('rejects unknown language codes', () => {
    expect(() =>
      SentenceResult.parse({ ...validResult, sourceLang: 'auto' }),
    ).toThrow()
  })
})
