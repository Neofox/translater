import type { LangCode } from './languages'
import type { Mode } from './types'
import type { UiLang } from './i18n'

export type Preferences = {
  source: LangCode
  target: LangCode
  mode: Mode
  uiLang: UiLang
  recentSource: LangCode | null
  recentTarget: LangCode | null
}
export type PreferencesSnapshot = {
  preferences: Preferences
  hasCookie: boolean
}
export const PREFERENCES_COOKIE = 'nt.preferences'
const MAX_AGE = 31536000
export const PREFERENCE_RULES: Record<
  keyof Preferences,
  {
    storage: string
    values: ReadonlyArray<string | null>
    raw?: boolean
  }
> = {
  source: {
    storage: 'nt.source',
    values: ['auto', 'en', 'ko', 'ja', 'fr', 'es', 'zh'],
  },
  target: {
    storage: 'nt.target',
    values: ['en', 'ko', 'ja', 'fr', 'es', 'zh'],
  },
  mode: { storage: 'nt.mode', values: ['friends', 'casual', 'professional'] },
  uiLang: { storage: 'ui-lang', values: ['en', 'ko'], raw: true },
  recentSource: {
    storage: 'nt.recentSource',
    values: [null, 'en', 'ko', 'ja', 'fr', 'es', 'zh'],
  },
  recentTarget: {
    storage: 'nt.recentTarget',
    values: [null, 'en', 'ko', 'ja', 'fr', 'es', 'zh'],
  },
}
const keys = Object.keys(PREFERENCE_RULES) as Array<keyof Preferences>

export function defaultPreferences(locale = 'en'): Preferences {
  const uiLang = locale.split(',')[0]!.trim().toLowerCase().startsWith('ko')
    ? 'ko'
    : 'en'
  return {
    source: 'auto',
    target: uiLang === 'ko' ? 'en' : 'ko',
    mode: 'casual',
    uiLang,
    recentSource: 'ja',
    recentTarget: 'ja',
  }
}

export function readPreferencesCookie(
  raw?: string,
  locale?: string,
): PreferencesSnapshot {
  try {
    const value: unknown = JSON.parse(raw ?? '')
    if (
      raw &&
      raw.length <= 1024 &&
      value &&
      typeof value === 'object' &&
      'version' in value &&
      value.version === 1 &&
      keys.every(
        (key) =>
          key in value &&
          PREFERENCE_RULES[key].values.includes(
            (value as Record<string, string | null>)[key]!,
          ),
      )
    ) {
      return {
        hasCookie: true,
        preferences: Object.fromEntries(
          keys.map((key) => [key, (value as Record<string, unknown>)[key]]),
        ) as Preferences,
      }
    }
  } catch {
    /* Invalid cookies fall back to browser-language defaults. */
  }
  return { hasCookie: false, preferences: defaultPreferences(locale) }
}

export function readLegacyPreferences(
  storage: Pick<Storage, 'getItem'>,
  defaults: Preferences,
): Preferences {
  const next = { ...defaults }
  let storedTarget = false
  for (const key of keys) {
    const rule = PREFERENCE_RULES[key]
    try {
      const raw = storage.getItem(rule.storage)
      if (raw === null) continue
      const value: unknown = rule.raw ? raw : JSON.parse(raw)
      if (!rule.values.includes(value as string | null)) continue
      Object.assign(next, { [key]: value })
      if (key === 'target') storedTarget = true
    } catch {
      /* Ignore unavailable storage or an invalid individual value. */
    }
  }
  if (!storedTarget) next.target = next.uiLang === 'ko' ? 'en' : 'ko'
  return next
}

export function encodePreferencesCookie(
  preferences: Preferences,
  secure: boolean,
) {
  const values = Object.fromEntries(keys.map((key) => [key, preferences[key]]))
  return `${PREFERENCES_COOKIE}=${encodeURIComponent(JSON.stringify({ version: 1, ...values }))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`
}

export function persistPreferences(preferences: Preferences) {
  try {
    document.cookie = encodePreferencesCookie(
      preferences,
      window.location.protocol === 'https:',
    )
  } catch {
    /* Cookies may be unavailable. */
  }
  for (const key of keys) {
    const rule = PREFERENCE_RULES[key]
    try {
      localStorage.setItem(
        rule.storage,
        rule.raw ? String(preferences[key]) : JSON.stringify(preferences[key]),
      )
    } catch {
      /* Keep preferences usable in memory. */
    }
  }
}

type BootstrapConfig = {
  snapshot: PreferencesSnapshot
  rules: typeof PREFERENCE_RULES
  cookie: string
  maxAge: number
}

// Self-contained because its source executes in <head>, before React or body
// content. Legacy-only browsers replace the navigation once with their cookie.
function bootstrapLegacyPreferences(config: BootstrapConfig) {
  const marker = 'nt.preferences.migrating'
  if (config.snapshot.hasCookie) {
    try {
      sessionStorage.removeItem(marker)
    } catch {
      /* Optional loop guard. */
    }
    return
  }
  try {
    const preferences = { ...config.snapshot.preferences }
    let storedTarget = false
    for (const key of Object.keys(config.rules) as Array<keyof Preferences>) {
      const rule = config.rules[key]
      try {
        const raw = localStorage.getItem(rule.storage)
        if (raw === null) continue
        const value: unknown = rule.raw ? raw : JSON.parse(raw)
        if (!rule.values.includes(value as string | null)) continue
        Object.assign(preferences, { [key]: value })
        if (key === 'target') storedTarget = true
      } catch {
        /* Keep the default for this setting. */
      }
    }
    if (!storedTarget)
      preferences.target = preferences.uiLang === 'ko' ? 'en' : 'ko'
    const payload = JSON.stringify({ version: 1, ...preferences })
    const encoded = encodeURIComponent(payload)
    document.cookie = `${config.cookie}=${encoded}; Path=/; Max-Age=${config.maxAge}; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`
    const written = document.cookie
      .split('; ')
      .some((part) => part === `${config.cookie}=${encoded}`)
    if (
      !written ||
      JSON.stringify(preferences) ===
        JSON.stringify(config.snapshot.preferences)
    )
      return
    try {
      if (sessionStorage.getItem(marker) === payload) return
      sessionStorage.setItem(marker, payload)
    } catch {
      /* A successfully written cookie still prevents another reload. */
    }
    window.location.replace(window.location.href)
  } catch {
    /* Continue rendering if browser storage is unavailable. */
  }
}

export function preferenceBootstrap(snapshot: PreferencesSnapshot) {
  return `;(${bootstrapLegacyPreferences.toString()})(${JSON.stringify({ snapshot, rules: PREFERENCE_RULES, cookie: PREFERENCES_COOKIE, maxAge: MAX_AGE })});`
}
