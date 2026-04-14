import { useEffect } from 'react'
import { detectLanguage } from '../lib/detectLanguage'
import type { LangCode } from '../lib/languages'

type Args = {
  input: string
  source: LangCode
  target: LangCode
  prevTarget: LangCode
  setTarget: (next: LangCode) => void
}

// When source is 'auto' and the detected input language matches the current
// target, swap the target — otherwise we'd be translating X → X. Restores the
// previous target if available, else toggles between en/ko.
export function useAutoSwapTarget({
  input,
  source,
  target,
  prevTarget,
  setTarget,
}: Args) {
  useEffect(() => {
    if (source !== 'auto') return
    const detected = detectLanguage(input)
    if (!detected || detected !== target) return
    const next =
      prevTarget !== detected ? prevTarget : detected === 'en' ? 'ko' : 'en'
    setTarget(next)
    // prevTarget/setTarget intentionally omitted: both are stable and reading
    // a stale prevTarget here is fine (we only consult it on user intent).
  }, [input, source, target])
}
