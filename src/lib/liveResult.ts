import type { LiveResult } from '../hooks/useTranslate'
import { translationRequestKey } from './translationRequestKey'

export function mainText(live: LiveResult | null): string | null {
  if (!live) return null
  if (live.intent === 'sentence') return live.partial.main ?? null
  return live.partial.primaryTranslation ?? null
}

export function resultIsCurrent(
  live: LiveResult | null,
  request: Parameters<typeof translationRequestKey>[0],
) {
  return Boolean(
    live?.requestKey && live.requestKey === translationRequestKey(request),
  )
}
