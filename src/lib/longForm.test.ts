import { describe, expect, it } from 'vitest'
import { isLongForm } from './longForm'

describe('isLongForm', () => {
  it('is false for empty and short single sentences', () => {
    expect(isLongForm('')).toBe(false)
    expect(isLongForm('   ')).toBe(false)
    expect(isLongForm('How are you doing today?')).toBe(false)
    expect(isLongForm('오늘 어떻게 지내요?')).toBe(false)
  })

  it('tolerates abbreviations and mid-text ellipses', () => {
    expect(isLongForm('Mr. Smith is here.')).toBe(false)
    expect(isLongForm('wait... what do you mean')).toBe(false)
  })

  it('is false for two sentences (one mid-text break)', () => {
    expect(isLongForm('Thanks a lot. See you tomorrow!')).toBe(false)
  })

  it('is true for multi-line input', () => {
    expect(isLongForm('hey\nare you free tonight?')).toBe(true)
  })

  it('is true for three or more sentences', () => {
    expect(
      isLongForm('I landed this morning. The flight was long. Call me later!'),
    ).toBe(true)
    expect(isLongForm('밥 먹었어? 나 지금 도착했어. 이따 보자!')).toBe(true)
  })

  it('is true past the length threshold even without terminators', () => {
    expect(isLongForm('a'.repeat(201))).toBe(true)
    expect(isLongForm('a'.repeat(200))).toBe(false)
  })
})
