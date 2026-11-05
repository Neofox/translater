import { describe, expect, it } from 'vitest'
import requests from '../../shared/translation/fixtures/requests.json'
import variants from '../../shared/translation/fixtures/variants.json'
import { SENTENCE_SYSTEMS } from '../../scripts/promptVariants'
import type { PromptVariant } from '../../scripts/promptVariants'
import { captureRequestBody } from '../../scripts/requestCapture'
import type { TranslateConfig } from './openai'
import type { TranslateInputData } from './translateTypes'

type Fixture = {
  name: string
  variant?: string
  input: unknown
  config: unknown
  body: unknown
}

// Golden request bodies captured from the pre-migration app. The model must
// receive exactly these bytes; the Go app reproduces the same fixtures.
describe('golden OpenAI request bodies', () => {
  it('covers at least twenty production requests', () => {
    expect(requests.length).toBeGreaterThanOrEqual(20)
  })

  it.each((requests as Fixture[]).map((f) => [f.name, f] as const))(
    '%s',
    async (_name, fixture) => {
      const body = await captureRequestBody(
        fixture.input as TranslateInputData,
        fixture.config as TranslateConfig,
      )
      expect(body).toEqual(fixture.body)
    },
  )

  it.each((variants as Fixture[]).map((f) => [f.name, f] as const))(
    'eval variant %s',
    async (_name, fixture) => {
      const body = await captureRequestBody(
        fixture.input as TranslateInputData,
        fixture.config as TranslateConfig,
        SENTENCE_SYSTEMS[fixture.variant as PromptVariant],
      )
      expect(body).toEqual(fixture.body)
    },
  )
})
