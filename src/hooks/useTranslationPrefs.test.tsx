// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTranslationPrefs } from './useTranslationPrefs'
import { UiLangProvider, useUiLang } from './useUiLang'
import { renderToString } from 'react-dom/server'

const savedPreferences = {
  hasCookie: true,
  preferences: {
    source: 'ko',
    target: 'fr',
    mode: 'professional',
    uiLang: 'ko',
    recentSource: 'zh',
    recentTarget: 'fr',
  },
} as const

function PreferencesSummary() {
  const { source, target, mode } = useTranslationPrefs()
  const { lang } = useUiLang()
  return <output>{[source, target, mode, lang].join('/')}</output>
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <UiLangProvider>{children}</UiLangProvider>
}

describe('useTranslationPrefs', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('renders saved languages and tone in server HTML before effects run', () => {
    const html = renderToString(
      <UiLangProvider initialPreferences={savedPreferences}>
        <PreferencesSummary />
      </UiLangProvider>,
    )
    expect(html).toContain('ko/fr/professional/ko')
  })

  it('keeps the server preference snapshot authoritative during hydration', async () => {
    localStorage.setItem('nt.source', JSON.stringify('auto'))
    localStorage.setItem('nt.target', JSON.stringify('en'))
    localStorage.setItem('nt.mode', JSON.stringify('friends'))
    localStorage.setItem('ui-lang', 'en')
    const { result } = renderHook(() => useTranslationPrefs(), {
      wrapper: ({ children }) => (
        <UiLangProvider initialPreferences={savedPreferences}>
          {children}
        </UiLangProvider>
      ),
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.source).toBe('ko')
    expect(result.current.target).toBe('fr')
    expect(result.current.mode).toBe('professional')
  })

  it('retains fresh-visit target selection semantics when effects replay', () => {
    const { result } = renderHook(
      () => ({ prefs: useTranslationPrefs(), ui: useUiLang() }),
      {
        wrapper,
        reactStrictMode: true,
      },
    )
    expect(result.current.prefs.target).toBe('ko')
    act(() => result.current.ui.setLang('ko'))
    expect(result.current.prefs.target).toBe('en')
  })

  it('defaults target to en on a fresh visit with Korean locale', async () => {
    window.localStorage.setItem('ui-lang', 'ko')

    const { result } = renderHook(() => useTranslationPrefs(), { wrapper })

    await waitFor(() => {
      expect(result.current.target).toBe('en')
    })
  })

  it('keeps target as ko on a fresh visit with English locale', async () => {
    window.localStorage.setItem('ui-lang', 'en')

    const { result } = renderHook(() => useTranslationPrefs(), { wrapper })

    // Give effects a tick to settle, then assert the default stayed put.
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.target).toBe('ko')
  })

  it('does not override a persisted target choice even with Korean locale', async () => {
    window.localStorage.setItem('ui-lang', 'ko')
    window.localStorage.setItem('nt.target', JSON.stringify('ja'))

    const { result } = renderHook(() => useTranslationPrefs(), { wrapper })

    await waitFor(() => {
      expect(result.current.target).toBe('ja')
    })

    // Stays ja — never gets clobbered back to 'en' by the correction effect.
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.target).toBe('ja')
  })

  it('treats an explicit user choice as final, even under Korean locale', async () => {
    window.localStorage.setItem('ui-lang', 'ko')

    const { result } = renderHook(() => useTranslationPrefs(), { wrapper })

    await waitFor(() => {
      expect(result.current.target).toBe('en')
    })

    act(() => {
      result.current.setTarget('ko')
    })

    expect(result.current.target).toBe('ko')

    // Later re-renders / effect re-runs must not stomp the user's choice.
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.target).toBe('ko')
  })
})
