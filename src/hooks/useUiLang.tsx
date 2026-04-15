import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { STRINGS, UI_LANGS   } from '../lib/i18n'
import type {StringKey, UiLang} from '../lib/i18n';

const STORAGE_KEY = 'ui-lang'

type UiLangCtx = {
  lang: UiLang
  setLang: (lang: UiLang) => void
  t: (key: StringKey) => string
}

const Ctx = createContext<UiLangCtx | null>(null)

function readInitial(): UiLang {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored && (UI_LANGS as string[]).includes(stored)) return stored as UiLang
  return window.navigator?.language?.toLowerCase().startsWith('ko')
    ? 'ko'
    : 'en'
}

export function UiLangProvider({ children }: { children: React.ReactNode }) {
  // Render server-side and initial client-side render in English so SSR output
  // is deterministic; hydrate to the stored/locale preference in an effect.
  const [lang, setLangState] = useState<UiLang>('en')

  useEffect(() => {
    setLangState(readInitial())
  }, [])

  const setLang = useCallback((next: UiLang) => {
    setLangState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage unavailable */
    }
  }, [])

  const value = useMemo<UiLangCtx>(
    () => ({
      lang,
      setLang,
      t: (key) => STRINGS[lang][key],
    }),
    [lang, setLang],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUiLang() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUiLang must be used inside <UiLangProvider>')
  return ctx
}
