import type { LiveResult } from '../hooks/useTranslate'

export function mainText(live: LiveResult | null): string | null {
  if (!live) return null
  if (live.intent === 'sentence') return live.partial.main ?? null
  return live.partial.primaryTranslation ?? null
}
