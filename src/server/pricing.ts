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

export type TokenCostDetails = {
  input: number
  cache_read_input_tokens: number
  cache_write_input_tokens: number
  output: number
  total: number
}

function configuredPrice(name: string) {
  const raw = process.env[name]
  if (!raw?.trim()) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

export function calculateTokenCostDetailsUsd(
  usage: UsageForPricing,
  prices: TokenPrices,
): TokenCostDetails {
  const regularInput = Math.max(
    0,
    usage.input - usage.cachedInput - usage.cacheWriteInput,
  )
  const input = (regularInput * prices.inputPer1M) / 1_000_000
  const cacheRead = (usage.cachedInput * prices.cachedInputPer1M) / 1_000_000
  const cacheWrite =
    (usage.cacheWriteInput * prices.cacheWriteInputPer1M) / 1_000_000
  const output = (usage.output * prices.outputPer1M) / 1_000_000
  const total =
    (regularInput * prices.inputPer1M +
      usage.cachedInput * prices.cachedInputPer1M +
      usage.cacheWriteInput * prices.cacheWriteInputPer1M +
      usage.output * prices.outputPer1M) /
    1_000_000

  return {
    input,
    cache_read_input_tokens: cacheRead,
    cache_write_input_tokens: cacheWrite,
    output,
    total,
  }
}

export function calculateTokenCostUsd(
  usage: UsageForPricing,
  prices: TokenPrices,
) {
  return calculateTokenCostDetailsUsd(usage, prices).total
}

export function configuredTokenCostDetailsUsd(usage: UsageForPricing) {
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

  return calculateTokenCostDetailsUsd(usage, {
    inputPer1M,
    cachedInputPer1M,
    cacheWriteInputPer1M,
    outputPer1M,
  })
}

export function configuredTokenCostUsd(usage: UsageForPricing) {
  return configuredTokenCostDetailsUsd(usage)?.total
}
