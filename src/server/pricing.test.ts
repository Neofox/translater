import { describe, expect, it } from 'vitest'
import { calculateTokenCostUsd } from './pricing'

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
