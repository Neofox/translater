import type { LangCode } from './languages'

type Args = {
  source: LangCode
  target: LangCode
  detected: LangCode | null
}

export function fallbackTargetFor(detected: LangCode): LangCode {
  return detected === 'en' ? 'ko' : 'en'
}

export function resolveTranslationTarget({
  source,
  target,
  detected,
}: Args): LangCode {
  if (source === 'auto' && detected && detected === target) {
    return fallbackTargetFor(detected)
  }
  return target
}
