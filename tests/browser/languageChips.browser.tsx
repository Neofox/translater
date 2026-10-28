import { act, useState } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import LanguageChipBar from '../../src/components/LanguageChipBar'
import { UiLangProvider } from '../../src/hooks/useUiLang'
import type { LangCode } from '../../src/lib/languages'

const cases: Array<{
  kind: 'source' | 'target'
  width: number
  value: LangCode
  expected: Array<string>
}> = [
  {
    kind: 'source',
    width: 600,
    value: 'auto',
    expected: ['auto', 'en', 'ko', 'ja'],
  },
  {
    kind: 'source',
    width: 320,
    value: 'ko',
    expected: ['auto', 'en', 'ko', 'ja'],
  },
  { kind: 'source', width: 319, value: 'ko', expected: ['ko'] },
  { kind: 'source', width: 220, value: 'en', expected: ['en'] },
  { kind: 'target', width: 600, value: 'ko', expected: ['en', 'ko', 'ja'] },
  { kind: 'target', width: 280, value: 'ko', expected: ['en', 'ko', 'ja'] },
  { kind: 'target', width: 279, value: 'ko', expected: ['ko'] },
  { kind: 'target', width: 180, value: 'fr', expected: ['fr'] },
  {
    kind: 'source',
    width: 600,
    value: 'fr',
    expected: ['auto', 'en', 'ko', 'fr'],
  },
]

test.each(cases)(
  '$kind language buttons are ready before hydration at $width px with $value selected',
  async ({ kind, width, value, expected }) => {
    const content = (
      <UiLangProvider>
        <div style={{ width }}>
          <LanguageChipBar kind={kind} value={value} onChange={vi.fn()} />
        </div>
      </UiLangProvider>
    )
    await render(
      <div
        data-testid="language-ssr-host"
        dangerouslySetInnerHTML={{ __html: renderToString(content) }}
      />,
    )
    const host = page.getByTestId('language-ssr-host').element()
    const visibleCodes = () =>
      [...host.querySelectorAll<HTMLElement>('[data-testid="lang-chip"]')]
        .filter((button) => button.checkVisibility())
        .map((button) => button.dataset.value)
    expect(visibleCodes()).toEqual(expected)
    const recoverable = vi.fn()
    let root: ReturnType<typeof hydrateRoot> | undefined
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    try {
      await act(async () => {
        root = hydrateRoot(host, content, { onRecoverableError: recoverable })
      })
      // Real browser interactions run outside React's synthetic act scope.
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
      expect(visibleCodes()).toEqual(expected)
      expect(recoverable).not.toHaveBeenCalled()
      const trigger = page.getByTestId('lang-more-trigger')
      await trigger.click()
      await expect.element(page.getByRole('listbox')).toBeVisible()
      for (const code of ['auto', 'en', 'ko', 'ja', 'fr', 'es', 'zh']) {
        const offered = Boolean(
          document.querySelector(
            `[data-testid="select-option"][data-value="${code}"]`,
          ),
        )
        expect(offered, `${code} in the menu`).toBe(
          (kind === 'source' || code !== 'auto') && !expected.includes(code),
        )
      }
    } finally {
      const hydratedRoot = root
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      if (hydratedRoot) await act(async () => hydratedRoot.unmount())
      vi.unstubAllGlobals()
    }
  },
)

function ResizableBar() {
  const [value, setValue] = useState<LangCode>('ko')
  return (
    <UiLangProvider>
      <div data-testid="language-container" style={{ width: 600 }}>
        <LanguageChipBar kind="source" value={value} onChange={setValue} />
      </div>
    </UiLangProvider>
  )
}

test('resizing language bars keeps hidden choices in the menu and outside accessibility navigation', async () => {
  await render(<ResizableBar />)
  const container = page.getByTestId('language-container').element()
  container.style.width = '180px'
  const visibleCodes = () =>
    [...container.querySelectorAll<HTMLElement>('[data-testid="lang-chip"]')]
      .filter((button) => button.checkVisibility())
      .map((button) => button.dataset.value)
  await expect.poll(visibleCodes).toEqual(['ko'])
  expect(
    page
      .getByRole('button')
      .elements()
      .map((button) => button.getAttribute('data-value')),
  ).toEqual(['ko'])
  const trigger = page.getByTestId('lang-more-trigger')
  await trigger.click()
  await expect
    .element(page.getByRole('option', { name: 'English', exact: true }))
    .toBeVisible()
  await page.getByRole('option', { name: 'Français', exact: true }).click()
  await expect.poll(visibleCodes).toEqual(['fr'])
  container.style.width = '600px'
  await expect.poll(visibleCodes).toEqual(['auto', 'en', 'ko', 'fr'])
  await trigger.click()
  await expect
    .element(page.getByRole('option', { name: '日本語', exact: true }))
    .toBeVisible()
  expect(
    document.querySelector('[data-testid="select-option"][data-value="fr"]'),
  ).toBeNull()
})
