import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { UiLangProvider, useUiLang } from '../../src/hooks/useUiLang'
import { useTranslationPrefs } from '../../src/hooks/useTranslationPrefs'
import LanguageChipBar from '../../src/components/LanguageChipBar'
import ModeToggle from '../../src/components/ModeToggle'
import {
  PREFERENCES_COOKIE,
  readPreferencesCookie,
} from '../../src/lib/preferences'
import type { Preferences } from '../../src/lib/preferences'

const saved: Array<Preferences> = [
  {
    source: 'ko',
    target: 'fr',
    mode: 'professional',
    uiLang: 'en',
    recentSource: 'zh',
    recentTarget: 'fr',
  },
  {
    source: 'ja',
    target: 'en',
    mode: 'friends',
    uiLang: 'ko',
    recentSource: 'ja',
    recentTarget: 'zh',
  },
]

function Controls() {
  const prefs = useTranslationPrefs()
  const { lang } = useUiLang()
  return (
    <>
      <output data-testid="saved-summary">
        {[prefs.source, prefs.target, prefs.mode, lang].join('/')}
      </output>
      <LanguageChipBar
        kind="source"
        value={prefs.source}
        onChange={prefs.setSource}
      />
      <LanguageChipBar
        kind="target"
        value={prefs.target}
        onChange={prefs.setTarget}
      />
      <ModeToggle value={prefs.mode} onChange={prefs.setMode} />
    </>
  )
}

test.each(saved)(
  'saved $source → $target and $mode preferences agree before and after hydration',
  async (preferences) => {
    localStorage.setItem('nt.source', JSON.stringify('auto'))
    localStorage.setItem('nt.target', JSON.stringify('ko'))
    localStorage.setItem('nt.mode', JSON.stringify('casual'))
    localStorage.setItem('ui-lang', 'en')
    const content = (
      <UiLangProvider initialPreferences={{ hasCookie: true, preferences }}>
        <Controls />
      </UiLangProvider>
    )
    await render(
      <div
        data-testid="prefs-ssr"
        dangerouslySetInnerHTML={{ __html: renderToString(content) }}
      />,
    )
    const host = page.getByTestId('prefs-ssr').element()
    const summary = () =>
      host.querySelector('[data-testid="saved-summary"]')!.textContent
    const expected = [
      preferences.source,
      preferences.target,
      preferences.mode,
      preferences.uiLang,
    ].join('/')
    expect(summary()).toBe(expected)
    const selected = () =>
      [...host.querySelectorAll('.language-chip[aria-pressed="true"]')].map(
        (button) => button.getAttribute('data-value'),
      )
    expect(selected()).toEqual([preferences.source, preferences.target])
    expect(
      host.querySelector(
        `[data-kind="target"] [data-value="${preferences.recentTarget}"]`,
      ),
    ).toBeTruthy()
    const recoverable = vi.fn()
    let root: ReturnType<typeof hydrateRoot> | undefined
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    try {
      await act(async () => {
        root = hydrateRoot(host, content, { onRecoverableError: recoverable })
      })
      expect(summary()).toBe(expected)
      expect(selected()).toEqual([preferences.source, preferences.target])
      expect(recoverable).not.toHaveBeenCalled()
    } finally {
      const hydrated = root
      if (hydrated) await act(async () => hydrated.unmount())
      vi.unstubAllGlobals()
    }
  },
)

test('a tone change is saved for the very next document request', async () => {
  const preferences = { ...saved[0]!, mode: 'casual' as const }
  await render(
    <UiLangProvider initialPreferences={{ hasCookie: true, preferences }}>
      <Controls />
    </UiLangProvider>,
  )
  const button = page.getByRole('button', { name: 'Professional', exact: true })
  if (button.query()?.checkVisibility()) await button.click()
  else
    await page
      .getByRole('combobox', { name: 'Tone', exact: true })
      .selectOptions('professional')
  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${PREFERENCES_COOKIE}=`))!
    .slice(PREFERENCES_COOKIE.length + 1)
  expect(readPreferencesCookie(decodeURIComponent(raw))).toEqual({
    hasCookie: true,
    preferences: { ...preferences, mode: 'professional' },
  })
})
