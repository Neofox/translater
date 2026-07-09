import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

function useStoredState<T>(
  getStorage: () => Storage,
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  // Use `initial` on both SSR and first client render so hydration matches.
  // Sync from storage in an effect, then persist subsequent updates.
  const [value, setValue] = useState<T>(initial)
  const hydrated = useRef(false)

  useEffect(() => {
    try {
      const raw = getStorage().getItem(key)
      if (raw != null) setValue(JSON.parse(raw) as T)
    } catch {
      /* ignore */
    }
    hydrated.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!hydrated.current) return
    try {
      getStorage().setItem(key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value])

  return [value, setValue]
}

export function usePersistentState<T>(key: string, initial: T) {
  return useStoredState<T>(() => window.localStorage, key, initial)
}

/** Same contract as usePersistentState, but sessionStorage-backed — state
 * survives reloads within the tab and starts fresh on a new visit. */
export function useSessionState<T>(key: string, initial: T) {
  return useStoredState<T>(() => window.sessionStorage, key, initial)
}
