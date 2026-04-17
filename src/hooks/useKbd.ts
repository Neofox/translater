import { useEffect, useState } from 'react'

// Mac-style (⌘↵) by default so SSR output matches the common case; client
// effect swaps in Ctrl+↵ on Windows/Linux.
export function useKbd() {
  const [isMac, setIsMac] = useState(true)
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform))
  }, [])
  return isMac
    ? { mod: '⌘', shift: '⇧', sep: '' }
    : { mod: 'Ctrl', shift: 'Shift', sep: '+' }
}
