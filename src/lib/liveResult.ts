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

/** Main Copy can finish ahead of learner details, but never use an old run. */
export function copyableMainText(
  live: LiveResult | null,
  request: Parameters<typeof translationRequestKey>[0],
  isPending: boolean,
): string | null {
  if (!live || !(live.done || live.mainReady)) return null
  if ((live.done && isPending) || !resultIsCurrent(live, request)) return null
  const text = mainText(live)
  return text?.trim() ? text : null
}
