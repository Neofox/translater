import type { ServiceTier } from '../src/server/openai.ts'

// OpenAI list prices in USD per 1M tokens on the Standard tier
// (developers.openai.com/api/docs/pricing, checked 2026-10-30). The Fast tier
// costs double. Direct OpenAI responses carry token usage but no cost, so
// evals estimate it here; cache writes are billed as ordinary input.
const STANDARD: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
  'gpt-6.1-terra': { input: 1, cached: 0.05, output: 5 },
  'gpt-6.1-sol': { input: 2, cached: 0.1, output: 10 },
}

const TIER_MULTIPLIER: Record<ServiceTier, number> = { default: 1, fast: 2 }

export function estimateCost(
  model: string,
  serviceTier: ServiceTier,
  usage: { input: number; cached: number; output: number },
): number | undefined {
  const price = STANDARD[model]
  if (!price) return undefined
  const perToken =
    (usage.input - usage.cached) * price.input +
    usage.cached * price.cached +
    usage.output * price.output
  return (perToken * TIER_MULTIPLIER[serviceTier]) / 1_000_000
}
