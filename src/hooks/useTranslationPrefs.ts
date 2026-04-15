import { useCallback, useState } from 'react'
import { usePersistentState } from '../lib/usePersistentState'
import type { LangCode } from '../lib/languages'
import type { Mode } from '../lib/types'

export function useTranslationPrefs() {
  const [input, setInput] = useState<string>('')

  const [source, setSource] = usePersistentState<LangCode>('nt.source', 'auto')
  const [target, setTarget] = usePersistentState<LangCode>('nt.target', 'ko')
  const [prevTarget, setPrevTarget] = usePersistentState<LangCode>(
    'nt.prevTarget',
    'en',
  )
  const [mode, setMode] = usePersistentState<Mode>('nt.mode', 'casual')

  // Track the prior target whenever target changes, so auto-swap can restore it.
  // Setters from useState/usePersistentState are stable, so empty deps is safe.
  const setTargetTracked = useCallback((next: LangCode) => {
    setTarget((curr) => {
      if (curr !== next) setPrevTarget(curr)
      return next
    })
  }, [])

  return {
    input,
    setInput,
    source,
    setSource,
    target,
    setTarget: setTargetTracked,
    prevTarget,
    mode,
    setMode,
  }
}

export type TranslationPrefs = ReturnType<typeof useTranslationPrefs>
