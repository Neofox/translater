import { useEffect } from 'react'
import type { LiveResult } from './useTranslate'

type Args = {
  hasInput: boolean
  live: LiveResult | null
  onForce: () => void
  onCopy: () => void
  onFocusInput: () => void
  onClear: () => void
}

export function useTranslatorShortcuts({
  hasInput,
  onForce,
  onCopy,
  onFocusInput,
  onClear,
}: Args) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'Enter') {
        e.preventDefault()
        onForce()
      } else if (meta && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        onCopy()
      } else if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        onFocusInput()
      } else if (e.key === 'Escape' && hasInput) {
        e.preventDefault()
        onClear()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasInput, onForce, onCopy, onFocusInput, onClear])
}
