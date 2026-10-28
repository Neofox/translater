import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  defaultPreferences,
  PREFERENCE_RULES,
  persistPreferences,
  readLegacyPreferences,
} from '../lib/preferences'
import type { Preferences, PreferencesSnapshot } from '../lib/preferences'

type SetPreference = <TKey extends keyof Preferences>(
  key: TKey,
  action: SetStateAction<Preferences[TKey]>,
) => void
const Context = createContext<{
  preferences: Preferences
  setPreference: SetPreference
} | null>(null)

export function PreferencesProvider({
  initial,
  children,
}: {
  initial?: PreferencesSnapshot
  children: ReactNode
}) {
  const [snapshot] = useState(initial)
  const [preferences, setPreferences] = useState(
    () => snapshot?.preferences ?? defaultPreferences(),
  )
  const current = useRef(preferences)
  const initialized = useRef(false)
  const targetChosen = useRef(
    Boolean(snapshot?.hasCookie) || preferences.uiLang === 'ko',
  )

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    if (!snapshot?.hasCookie) {
      let next = snapshot?.preferences ?? defaultPreferences(navigator.language)
      try {
        next = readLegacyPreferences(localStorage, next)
        const rawTarget = localStorage.getItem('nt.target')
        targetChosen.current =
          next.uiLang === 'ko' ||
          Boolean(
            rawTarget &&
            PREFERENCE_RULES.target.values.includes(JSON.parse(rawTarget)),
          )
      } catch {
        /* Browser storage may be unavailable. */
      }
      current.current = next
      setPreferences(next)
    }
    persistPreferences(current.current)
  }, [snapshot])

  const setPreference = useCallback<SetPreference>((key, action) => {
    const value =
      typeof action === 'function' ? action(current.current[key]) : action
    if (!PREFERENCE_RULES[key].values.includes(value)) return
    const next = { ...current.current, [key]: value }
    if (key === 'target') targetChosen.current = true
    if (key === 'uiLang' && value === 'ko' && !targetChosen.current) {
      next.target = 'en'
      targetChosen.current = true
    }
    current.current = next
    setPreferences(next)
    // Persist within the user action so an immediate reload sees the choice.
    persistPreferences(next)
  }, [])

  const value = useMemo(
    () => ({ preferences, setPreference }),
    [preferences, setPreference],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function usePreference<TKey extends keyof Preferences>(
  key: TKey,
): [Preferences[TKey], Dispatch<SetStateAction<Preferences[TKey]>>] {
  const context = useContext(Context)
  if (!context)
    throw new Error('usePreference must be used inside PreferencesProvider')
  const { setPreference } = context
  const set = useCallback<Dispatch<SetStateAction<Preferences[TKey]>>>(
    (next) => setPreference(key, next),
    [key, setPreference],
  )
  return [context.preferences[key], set]
}
