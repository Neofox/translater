// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  PREFERENCES_COOKIE,
  defaultPreferences,
  encodePreferencesCookie,
  preferenceBootstrap,
  readLegacyPreferences,
  readPreferencesCookie,
} from './preferences'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  document.cookie = `${PREFERENCES_COOKIE}=; Max-Age=0; Path=/`
})

const saved = {
  source: 'ko',
  target: 'fr',
  mode: 'professional',
  uiLang: 'ko',
  recentSource: 'zh',
  recentTarget: 'fr',
} as const

it('reads only validated UI preferences from the request cookie', () => {
  const raw = JSON.stringify({
    version: 1,
    ...saved,
    input: 'private draft',
    context: 'private reply',
  })
  expect(readPreferencesCookie(raw, 'en-US')).toEqual({
    hasCookie: true,
    preferences: saved,
  })
  expect(
    encodePreferencesCookie(
      { ...saved, input: 'private draft' } as typeof saved,
      true,
    ),
  ).not.toContain('private')
})

it.each([
  'broken',
  'null',
  '{"version":2}',
  JSON.stringify({ version: 1, ...saved, target: 'auto' }),
  JSON.stringify({ version: 1, ...saved, mode: 'injected' }),
])('ignores malformed or unsupported preference cookies: %s', (raw) => {
  expect(readPreferencesCookie(raw, 'ko-KR,ko;q=0.9')).toEqual({
    hasCookie: false,
    preferences: defaultPreferences('ko'),
  })
})

it('chooses the initial default target from the first browser language', () => {
  expect(defaultPreferences('ko-KR,ko;q=0.9').target).toBe('en')
  expect(defaultPreferences('en-US,en;q=0.9,ko;q=0.8').target).toBe('ko')
})

it('migrates legacy languages, tone, UI language and recent shortcuts', () => {
  for (const [key, value] of Object.entries({
    'nt.source': 'ko',
    'nt.target': 'fr',
    'nt.mode': 'professional',
    'nt.recentSource': 'zh',
    'nt.recentTarget': 'fr',
  }))
    localStorage.setItem(key, JSON.stringify(value))
  localStorage.setItem('ui-lang', 'ko')
  expect(readLegacyPreferences(localStorage, defaultPreferences())).toEqual(
    saved,
  )
})

it('keeps a legacy target choice and derives a missing target from the saved UI language', () => {
  localStorage.setItem('ui-lang', 'ko')
  localStorage.setItem('nt.mode', 'invalid JSON')
  expect(readLegacyPreferences(localStorage, defaultPreferences()).target).toBe(
    'en',
  )
  localStorage.setItem('nt.target', JSON.stringify('ja'))
  expect(readLegacyPreferences(localStorage, defaultPreferences()).target).toBe(
    'ja',
  )
})

it('migrates before the app starts and requests one replacement load with the cookie', () => {
  localStorage.setItem('nt.source', JSON.stringify('ko'))
  localStorage.setItem('nt.target', JSON.stringify('fr'))
  localStorage.setItem('nt.mode', JSON.stringify('professional'))
  const replace = vi.fn()
  const script = preferenceBootstrap({
    hasCookie: false,
    preferences: defaultPreferences(),
  })
  const run = new Function(
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    script,
  )
  run(
    {
      location: {
        protocol: 'https:',
        href: 'https://translate.example/',
        replace,
      },
    },
    document,
    localStorage,
    sessionStorage,
  )
  const encoded = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${PREFERENCES_COOKIE}=`))!
    .split('=')[1]!
  expect(
    readPreferencesCookie(decodeURIComponent(encoded)).preferences,
  ).toMatchObject({ source: 'ko', target: 'fr', mode: 'professional' })
  expect(replace).toHaveBeenCalledExactlyOnceWith('https://translate.example/')
  run(
    {
      location: {
        protocol: 'https:',
        href: 'https://translate.example/',
        replace,
      },
    },
    document,
    localStorage,
    sessionStorage,
  )
  expect(replace).toHaveBeenCalledTimes(1)
})

it('does not reload when cookies are unavailable', () => {
  localStorage.setItem('nt.mode', JSON.stringify('professional'))
  const replace = vi.fn()
  const documentWithoutCookies = {
    get cookie() {
      return ''
    },
    set cookie(_value: string) {},
  }
  new Function(
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    preferenceBootstrap({
      hasCookie: false,
      preferences: defaultPreferences(),
    }),
  )(
    {
      location: {
        protocol: 'https:',
        href: 'https://translate.example/',
        replace,
      },
    },
    documentWithoutCookies,
    localStorage,
    sessionStorage,
  )
  expect(replace).not.toHaveBeenCalled()
})
