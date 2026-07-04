import { describe, expect, it } from 'vitest'
import { SentenceResult } from './schemas'

describe('SentenceResult', () => {
  it('keeps the first three character learning tips when the model returns more', () => {
    const characters = ['學', '校', '生', '活'].map((char) => ({
      word: char,
      chars: [{ char, meaning: char }],
    }))

    const result = SentenceResult.parse({
      main: 'School life',
      rationale: 'A direct translation.',
      alternatives: [],
      formalityNote: '',
      learningTips: {
        grammar: '',
        vocab: '',
        characters,
      },
    })

    expect(result.learningTips.characters).toEqual(characters.slice(0, 3))
  })
})
