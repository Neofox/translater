import { useEffect, useState } from 'react'
import { usePersistentState } from '../lib/usePersistentState'
import { useUiLang } from './useUiLang'
import type { LangCode } from '../lib/languages'
import type { Mode } from '../lib/types'

export function useTranslationPrefs() {
  const [input, setInput] = useState<string>('')
  const { lang: uiLang } = useUiLang()

  const [source, setSource] = usePersistentState<LangCode>('nt.source', 'auto')
  const [target, setTarget] = usePersistentState<LangCode>('nt.target', 'ko')
  const [mode, setMode] = usePersistentState<Mode>('nt.mode', 'casual')

  // Default target mirrors the UI language (EN UI → ko, 한 UI → en). uiLang
  // hydrates async, so correct the default reactively — but only until the
  // user has ever chosen a target (a persisted value always wins).
  useEffect(() => {
    try {
      if (window.localStorage.getItem('nt.target') == null && uiLang === 'ko') {
        setTarget('en')
      }
    } catch {
      /* ignore */
    }
  }, [uiLang, setTarget])

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
