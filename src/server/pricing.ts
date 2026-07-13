export type UsageForPricing = {
  input: number
  cachedInput: number
  cacheWriteInput: number
  output: number
}

export type TokenPrices = {
  inputPer1M: number
  cachedInputPer1M: number
  cacheWriteInputPer1M: number
  outputPer1M: number
}

export function calculateTokenCostUsd(
  usage: UsageForPricing,
  prices: TokenPrices,
) {
  const regularInput = Math.max(
    0,
    usage.input - usage.cachedInput - usage.cacheWriteInput,
  )
  return (
    (regularInput * prices.inputPer1M +
      usage.cachedInput * prices.cachedInputPer1M +
      usage.cacheWriteInput * prices.cacheWriteInputPer1M +
      usage.output * prices.outputPer1M) /
    1_000_000
  )
}
