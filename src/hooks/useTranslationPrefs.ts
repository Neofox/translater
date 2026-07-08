import { useCallback, useEffect, useRef, useState } from 'react'
import { usePersistentState } from '../lib/usePersistentState'
import { useUiLang } from './useUiLang'
import type { LangCode } from '../lib/languages'
import type { Mode } from '../lib/types'

export function useTranslationPrefs() {
  const [input, setInput] = useState<string>('')
  const { lang: uiLang } = useUiLang()

  const [source, setSource] = usePersistentState<LangCode>('nt.source', 'auto')
  const [target, setTargetState] = usePersistentState<LangCode>(
    'nt.target',
    'ko',
  )
  const [mode, setMode] = usePersistentState<Mode>('nt.mode', 'casual')

  // usePersistentState stamps its default into localStorage on first mount,
  // so "has the user ever chosen a target" must be captured synchronously,
  // before any effect runs. Any later setTarget call counts as a choice.
  const [hadStoredTarget] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      return window.localStorage.getItem('nt.target') != null
    } catch {
      return true
    }
  })
  const targetChosen = useRef(hadStoredTarget)

  const setTarget: typeof setTargetState = useCallback(
    (next) => {
      targetChosen.current = true
      setTargetState(next)
    },
    [setTargetState],
  )

  // Default target mirrors the UI language (EN UI → ko, 한 UI → en). uiLang
  // hydrates async, so correct the default reactively until a choice lands.
  useEffect(() => {
    if (uiLang === 'ko' && !targetChosen.current) {
      targetChosen.current = true
      setTargetState('en')
    }
  }, [uiLang, setTargetState])

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
