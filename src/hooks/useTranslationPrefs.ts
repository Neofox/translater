import { useState } from 'react'
import { usePreference } from '../context/PreferencesContext'

export function useTranslationPrefs() {
  const [input, setInput] = useState('')
  const [source, setSource] = usePreference('source')
  const [target, setTarget] = usePreference('target')
  const [mode, setMode] = usePreference('mode')
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
