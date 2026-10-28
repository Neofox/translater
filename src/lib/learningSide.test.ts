import { expect, it } from 'vitest'
import { learningSide } from './learningSide'

it.each([
  ['ko', 'en', 'en', 'source'],
  ['en', 'ko', 'en', 'target'],
  ['en', 'ko', 'ko', 'source'],
  ['ko', 'en', 'ko', 'target'],
  ['ja', 'en', 'en', 'source'],
  ['ko', 'ja', 'en', 'target'],
  ['en', 'en', 'en', 'target'],
])(
  'learns %s → %s with %s UI from the %s side',
  (source, target, uiLang, expected) => {
    expect(learningSide(source, target, uiLang)).toBe(expected)
  },
)
