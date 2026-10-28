import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react'
import { STRINGS } from '../lib/i18n'
import {
  PreferencesProvider,
  usePreference,
} from '../context/PreferencesContext'
import type { PreferencesSnapshot } from '../lib/preferences'
import type { StringKey, UiLang } from '../lib/i18n'

type UiLangCtx = {
  lang: UiLang
  setLang: (lang: UiLang) => void
  t: (key: StringKey) => string
}

const Ctx = createContext<UiLangCtx | null>(null)

export function UiLangProvider({
  children,
  initialPreferences,
}: {
  children: React.ReactNode
  initialPreferences?: PreferencesSnapshot
}) {
  return (
    <PreferencesProvider initial={initialPreferences}>
      <UiLangContent>{children}</UiLangContent>
    </PreferencesProvider>
  )
}

function UiLangContent({ children }: { children: React.ReactNode }) {
  const [lang, setLanguage] = usePreference('uiLang')
  const setLang = useCallback(
    (next: UiLang) => setLanguage(next),
    [setLanguage],
  )
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

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
