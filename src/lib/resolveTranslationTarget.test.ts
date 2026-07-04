import { describe, expect, it } from 'vitest'
import { detectLanguage } from './detectLanguage'
import { resolveTranslationTarget } from './resolveTranslationTarget'

describe('resolveTranslationTarget', () => {
  it('routes Korean auto input to English when Korean is selected as target', () => {
    const text =
      '[신한카드]온라인명세서로 1년간 면제된 SMS이용료200원 서비스가 종료됩니다(기간만료:05월)'
    const detected = detectLanguage(text)

    expect(detected).toBe('ko')
    expect(
      resolveTranslationTarget({
        source: 'auto',
        target: 'ko',
        detected,
      }),
    ).toBe('en')
  })

  it('keeps explicit same-language pairs available for polish mode', () => {
    expect(
      resolveTranslationTarget({
        source: 'ko',
        target: 'ko',
        detected: null,
      }),
    ).toBe('ko')
  })

  it('routes English auto input away from English', () => {
    expect(
      resolveTranslationTarget({
        source: 'auto',
        target: 'en',
        detected: 'en',
      }),
    ).toBe('ko')
  })
})
