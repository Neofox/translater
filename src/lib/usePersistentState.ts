import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial)

  // Hydrate once from localStorage on mount. `key` isn't in deps because we
  // only want this to run for the initial key — remounting for a new key is the
  // caller's responsibility.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw != null) setValue(JSON.parse(raw) as T)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  }, [key, value])

  return [value, setValue]
}
