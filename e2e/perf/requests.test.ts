import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isTranslationRequest } from './requests.ts'

const origin = 'https://app.example'

describe('isTranslationRequest', () => {
  it('counts the form post that carries text', () => {
    assert.equal(
      isTranslationRequest(
        'POST',
        `${origin}/translate`,
        origin,
        'run=1&text=Hello&source=auto',
      ),
      true,
    )
  })

  it('ignores the free warm-up call, GETs and other origins', () => {
    assert.equal(
      isTranslationRequest('POST', `${origin}/warm`, origin, null),
      false,
    )
    assert.equal(
      isTranslationRequest('GET', `${origin}/translate`, origin, 'text=x'),
      false,
    )
    assert.equal(
      isTranslationRequest('POST', 'https://other.example/t', origin, 'text=x'),
      false,
    )
  })
})
