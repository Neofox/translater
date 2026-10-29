import { describe, expect, it } from 'vitest'
import { SentenceResult, WordResult } from './schemas'

const characterEntry = (char: string) => ({
  word: char,
  chars: [{ char, meaning: char }],
})

const validResult = {
  sourceLang: 'zh',
  targetLang: 'en',
  main: 'School life',
  learningPhrases: [
    {
      text: 'School life',
      gloss: 'life at school',
      sourceTexts: ['學校生活'],
      baseForm: '',
      literalMeaning: '',
      naturalMeaning: 'life at school',
      grammar: '',
      omissions: '',
      grammarHighlights: [],
      usageNote: '',
      characters: ['學', '校', '生'].map(characterEntry),
    },
  ],
  rationale: 'A direct translation.',
  alternatives: [],
  formalityNote: '',
}

describe('SentenceResult', () => {
  it('requires phrase details and explicit grammar highlight quotations in the initial response', () => {
    const {
      baseForm: _base,
      grammarHighlights: _highlights,
      ...incomplete
    } = validResult.learningPhrases[0]!
    expect(
      SentenceResult.safeParse({
        ...validResult,
        learningPhrases: [incomplete],
      }).success,
    ).toBe(false)
    expect(SentenceResult.safeParse(validResult).success).toBe(true)
  })
  it('requires usage and character fields even when they are empty', () => {
    const {
      usageNote: _usage,
      characters: _characters,
      ...oldPhrase
    } = validResult.learningPhrases[0]!
    expect(
      SentenceResult.safeParse({ ...validResult, learningPhrases: [oldPhrase] })
        .success,
    ).toBe(false)
  })
  it('keeps all learner notes in phrase or dictionary details, with no global tips object', () => {
    expect(SentenceResult.shape).not.toHaveProperty('learningTips')
    expect(WordResult.shape).not.toHaveProperty('learningTips')
    expect(WordResult.shape).toHaveProperty('grammar')
    expect(WordResult.shape).toHaveProperty('characters')
  })
  it('accepts a fully populated strict payload', () => {
    const result = SentenceResult.parse(validResult)
    expect(result.learningPhrases[0]!.characters).toHaveLength(3)
  })

  it('rejects more than three character tips (strict schema enforces the cap)', () => {
    const overLimit = {
      ...validResult,
      learningPhrases: [
        {
          ...validResult.learningPhrases[0],
          characters: ['學', '校', '生', '活'].map(characterEntry),
        },
      ],
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
