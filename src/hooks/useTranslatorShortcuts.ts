import { useEffect } from 'react'
import type { LiveResult } from './useTranslate'

type Args = {
  hasInput: boolean
  live: LiveResult | null
  onForce: () => void
  onCopy: () => void
  onSwap: () => void
  onFocusInput: () => void
  onClear: () => void
}

// Global keyboard shortcuts. Deps are intentionally omitted: each handler is
// expected to read current state via closure at call-time, and the listener
// itself is idempotent.
export function useTranslatorShortcuts({
  hasInput,
  onForce,
  onCopy,
  onSwap,
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
      } else if (meta && e.key === '/') {
        e.preventDefault()
        onSwap()
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
  }, [hasInput, onForce, onCopy, onSwap, onFocusInput, onClear])
}
