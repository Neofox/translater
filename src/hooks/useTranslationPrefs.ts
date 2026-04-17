import { useState } from 'react'
import { usePersistentState } from '../lib/usePersistentState'
import type { LangCode } from '../lib/languages'
import type { Mode } from '../lib/types'

export function useTranslationPrefs() {
  const [input, setInput] = useState<string>('')

  const [source, setSource] = usePersistentState<LangCode>('nt.source', 'auto')
  const [target, setTarget] = usePersistentState<LangCode>('nt.target', 'ko')
  const [mode, setMode] = usePersistentState<Mode>('nt.mode', 'casual')

  return {
    input,
    setInput,
    source,
    setSource,
    target,
    setTarget,
    mode,
    setMode,
  }
}

export type TranslationPrefs = ReturnType<typeof useTranslationPrefs>
