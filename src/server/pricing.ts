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

function configuredPrice(name: string) {
  const raw = process.env[name]
  if (!raw?.trim()) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
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

export function configuredTokenCostUsd(usage: UsageForPricing) {
  const inputPer1M = configuredPrice('TRANSLATE_PRICE_INPUT_PER_1M')
  const cachedInputPer1M = configuredPrice(
    'TRANSLATE_PRICE_CACHED_INPUT_PER_1M',
  )
  const cacheWriteInputPer1M = configuredPrice(
    'TRANSLATE_PRICE_CACHE_WRITE_INPUT_PER_1M',
  )
  const outputPer1M = configuredPrice('TRANSLATE_PRICE_OUTPUT_PER_1M')

  if (
    inputPer1M === undefined ||
    cachedInputPer1M === undefined ||
    cacheWriteInputPer1M === undefined ||
    outputPer1M === undefined
  ) {
    return undefined
  }

  return calculateTokenCostUsd(usage, {
    inputPer1M,
    cachedInputPer1M,
    cacheWriteInputPer1M,
    outputPer1M,
  })
}
