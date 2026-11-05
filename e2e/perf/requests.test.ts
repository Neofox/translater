import { describe, expect, it } from 'vitest'
import { isTranslationRequest } from './requests.ts'

const origin = 'https://app.example'

describe('isTranslationRequest', () => {
  it('counts the TS server function and the Go form post that carry text', () => {
    const ts =
      '{"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":10,"i":1,"p":{"k":["text","source"]'
    expect(
      isTranslationRequest('POST', `${origin}/_serverFn/d178c6`, origin, ts),
    ).toBe(true)
    expect(
      isTranslationRequest(
        'POST',
        `${origin}/translate`,
        origin,
        'run=1&text=Hello&source=auto',
      ),
    ).toBe(true)
  })

  it('ignores the free warm-up calls, GETs and other origins', () => {
    expect(
      isTranslationRequest('POST', `${origin}/_serverFn/c8fd2d`, origin, ''),
    ).toBe(false)
    expect(isTranslationRequest('POST', `${origin}/warm`, origin, null)).toBe(
      false,
    )
    expect(
      isTranslationRequest('GET', `${origin}/translate`, origin, 'text=x'),
    ).toBe(false)
    expect(
      isTranslationRequest('POST', 'https://other.example/t', origin, 'text=x'),
    ).toBe(false)
  })
})
