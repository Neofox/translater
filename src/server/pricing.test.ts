import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateTokenCostUsd, configuredTokenCostUsd } from './pricing'

const lunaPrices = {
  inputPer1M: 1,
  cachedInputPer1M: 0.1,
  cacheWriteInputPer1M: 1.25,
  outputPer1M: 6,
}

describe('calculateTokenCostUsd', () => {
  it('prices ordinary input and output', () => {
    expect(
      calculateTokenCostUsd(
        { input: 1_000, cachedInput: 0, cacheWriteInput: 0, output: 100 },
        lunaPrices,
      ),
    ).toBe(0.0016)
  })

  it('prices cache reads and writes at their distinct rates', () => {
    expect(
      calculateTokenCostUsd(
        {
          input: 1_000,
          cachedInput: 600,
          cacheWriteInput: 300,
          output: 100,
        },
        lunaPrices,
      ),
    ).toBe(0.001135)
  })
})

describe('configuredTokenCostUsd', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the configured cache-aware rates', () => {
    vi.stubEnv('TRANSLATE_PRICE_INPUT_PER_1M', '1')
    vi.stubEnv('TRANSLATE_PRICE_CACHED_INPUT_PER_1M', '0.1')
    vi.stubEnv('TRANSLATE_PRICE_CACHE_WRITE_INPUT_PER_1M', '1.25')
    vi.stubEnv('TRANSLATE_PRICE_OUTPUT_PER_1M', '6')

    expect(
      configuredTokenCostUsd({
        input: 1_000,
        cachedInput: 600,
        cacheWriteInput: 300,
        output: 100,
      }),
    ).toBe(0.001135)
  })

  it('requires all four current pricing rates', () => {
    vi.stubEnv('TRANSLATE_PRICE_INPUT_PER_1M', '1')
    vi.stubEnv('TRANSLATE_PRICE_CACHED_INPUT_PER_1M', '')
    vi.stubEnv('TRANSLATE_PRICE_CACHE_WRITE_INPUT_PER_1M', '1.25')
    vi.stubEnv('TRANSLATE_PRICE_OUTPUT_PER_1M', '6')

    expect(
      configuredTokenCostUsd({
        input: 100,
        cachedInput: 0,
        cacheWriteInput: 0,
        output: 20,
      }),
    ).toBeUndefined()
  })
})
