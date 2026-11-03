// Workspace layout (@layout): the measured layout, its server-rendered first
// paint and the panel order. Ports of tests/browser/mobile.browser.tsx and
// useWorkspaceLayout.test.tsx cases that need a real browser.
import type { BrowserContextOptions, Page, Route } from '@playwright/test'
import {
  expect,
  fillSource,
  openApp,
  sentence,
  source,
  test,
  waitForDone,
} from './helpers'

// Pretendard loads from a CDN with `font-display: optional`: block it so
// both paints use the same fallback font.
const WEB_FONTS = /^https:\/\/cdn\.jsdelivr\.net\//

function panels(page: Page) {
  return page.locator('.translator-panels')
}

/** Expected measured mode for a viewport and its side insets. */
function expectedMode(width: number, height: number, insets: number): string {
  const usable = width - insets
  return usable >= 1100
    ? 'workspace'
    : usable >= 560 && usable > height
      ? 'split'
      : 'stack'
}

test('layout changes keep the textarea node, caret and focus @layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1512, height: 982 })
  await openApp(page)
  await expect(panels(page)).toHaveAttribute('data-layout', 'workspace')
  await source(page).click()
  await page.keyboard.type('hello world')
  await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    ;(window as unknown as { __ta: Element }).__ta = ta
    ta.setSelectionRange(5, 5)
  })
  for (const [width, mode] of [
    [700, 'stack'],
    [1512, 'workspace'],
    [700, 'stack'],
  ] as const) {
    await page.setViewportSize({ width, height: 982 })
    await expect(panels(page)).toHaveAttribute('data-layout', mode)
    expect(
      await page.evaluate(() => {
        const ta = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="input-textarea"]',
        )!
        const first = document.querySelector('.translator-panels > section')!
        return {
          same: ta === (window as unknown as { __ta: Element }).__ta,
          focused: document.activeElement === ta,
          caret: [ta.selectionStart, ta.selectionEnd],
          value: ta.value,
          first: first.className,
        }
      }),
    ).toEqual({
      same: true,
      focused: true,
      caret: [5, 5],
      value: 'hello world',
      first: mode === 'stack' ? 'output-panel' : 'input-panel',
    })
  }
})

type Box = { x: number; y: number; width: number; height: number }

/** Boxes of the elements the first paint must already place. */
async function boxes(page: Page): Promise<{ elements: Box[]; chips: Box[][] }> {
  return page.evaluate(() => {
    const box = (e: Element | null): Box => {
      if (!e) throw new Error('missing element')
      const { x, y, width, height } = e.getBoundingClientRect()
      return { x, y, width, height }
    }
    const elements = [
      '.app-header',
      '.input-panel',
      '.output-panel',
      '.composer',
      '[data-testid="input-textarea"]',
      '[data-testid="output-toolbar"] [data-testid="copy-button"]',
      '[data-testid="output-toolbar"] [data-testid="listen-button"]',
    ].map((selector) => box(document.querySelector(selector)))
    const chips = [...document.querySelectorAll<HTMLElement>('.language-chip-bar')]
      .filter((bar) => bar.checkVisibility())
      .sort((a, b) =>
        String(a.getAttribute('aria-label')).localeCompare(
          String(b.getAttribute('aria-label')),
        ),
      )
      .map((bar) =>
        [
          ...bar.querySelectorAll('[data-testid="lang-chip"]'),
          bar.querySelector('[data-testid="lang-more-trigger"]'),
        ]
          .filter((e): e is HTMLElement => e instanceof HTMLElement && e.checkVisibility())
          .map(box),
      )
    return { elements, chips }
  })
}

for (const inset of [0, 12, 64]) {
  test(`server-rendered first paint matches the measured layout with ${inset} px side insets @layout`, async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const { width, height } = page.viewportSize()!
    // Side insets as browsers report them (env()): the page's own :root
    // value, so the style goes after the stylesheet.
    const prepare = async (target: Page) => {
      await target.route(WEB_FONTS, (route) => route.abort())
      await target.route(
        (url) => url.origin === new URL(baseURL!).origin && url.pathname === '/',
        async (route: Route) => {
          const response = await route.fetch()
          const body = (await response.text()).replace(
            '</head>',
            `<style>:root{--safe-area-left:${inset}px;--safe-area-right:${inset}px}</style></head>`,
          )
          await route.fulfill({ response, body })
        },
      )
    }

    // The script-free (server-rendered) paint gets its own context. WebKit
    // keeps a failed <link rel=modulepreload> response in its memory cache
    // for the page's next documents, so a scripted load after an aborted
    // one in the same page never fetches the modules. Both apps show it
    // through a plain proxy too (no interception); there it clears after
    // two reloads for TS and three for Go.
    const { viewport, hasTouch, locale, reducedMotion } = testInfo.project.use
    const options: BrowserContextOptions = { viewport, hasTouch, locale, reducedMotion, baseURL }
    const ssrContext = await browser.newContext(options)
    let before: Awaited<ReturnType<typeof boxes>>
    try {
      const ssr = await ssrContext.newPage()
      await prepare(ssr)
      await ssr.route('**/*', (route) =>
        route.request().resourceType() === 'script' ? route.abort() : route.fallback(),
      )
      await ssr.goto('/')
      await expect(source(ssr)).toBeVisible()
      expect(
        await ssr.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--safe-area-left')
            .trim(),
        ),
      ).toBe(`${inset}px`)
      await expect(panels(ssr)).toHaveAttribute('data-layout-pending', /.*/)
      before = await boxes(ssr)
    } finally {
      await ssrContext.close()
    }
    const usable = width - 2 * inset
    const twoColumns = usable >= 1100 || (usable >= 560 && usable > height)
    const [input, output] = before.elements.slice(1, 3) as [Box, Box]
    if (twoColumns) {
      expect(Math.abs(input.y - output.y)).toBeLessThanOrEqual(1)
      expect(input.x + input.width).toBeLessThanOrEqual(output.x + 1)
    } else {
      expect(output.y + output.height).toBeLessThanOrEqual(input.y + 1)
    }

    await prepare(page)
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(panels(page)).not.toHaveAttribute('data-layout-pending')
    await expect(panels(page)).toHaveAttribute(
      'data-layout',
      expectedMode(width, height, 2 * inset),
    )
    const after = await boxes(page)
    expect(after.chips.map((bar) => bar.length)).toEqual(
      before.chips.map((bar) => bar.length),
    )
    const close = (a: Box, b: Box, label: string) => {
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(a[key] - b[key]), `${label} ${key}`).toBeLessThanOrEqual(1)
    }
    before.elements.forEach((box, i) => close(box, after.elements[i]!, `element ${i}`))
    before.chips.forEach((bar, i) =>
      bar.forEach((box, j) => close(box, after.chips[i]![j]!, `chip ${i}/${j}`)),
    )
  })
}

test('desktop source and reference share the left pane while alternatives stay right @layout', async ({
  page,
}) => {
  const { width, height } = page.viewportSize()!
  test.skip(width < 1100 || height < 640, 'desktop workspace only')
  await openApp(page)
  await expect(panels(page)).toHaveAttribute('data-layout', 'workspace')
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect()
    return {
      source: rect('.input-panel'),
      result: rect('.output-panel'),
      textarea: rect('[data-testid="input-textarea"]'),
      footer: rect('.composer-actions'),
      why: rect('.detail-why'),
      actions: rect('.primary-result-actions'),
      alternatives: rect('.detail-alternatives'),
      rows: [
        ...document.querySelectorAll('[data-testid="alternative-item"]'),
      ].map((row) => row.getBoundingClientRect()),
      whyCount: document.querySelectorAll('.detail-why').length,
      viewport: [window.innerWidth, window.innerHeight],
    }
  })
  const { source, result, textarea, footer, why, actions, alternatives } =
    geometry
  expect(source.right).toBeLessThanOrEqual(result.left)
  expect(Math.abs(source.top - result.top)).toBeLessThanOrEqual(1)
  expect(textarea.height).toBeLessThan(source.height * 0.36)
  expect(footer.top - textarea.bottom).toBeLessThanOrEqual(16)
  expect(why.left).toBeGreaterThanOrEqual(result.left)
  expect(why.top).toBeGreaterThanOrEqual(actions.bottom)
  expect(alternatives.left).toBeGreaterThanOrEqual(result.left)
  expect(geometry.whyCount).toBe(1)
  await expect(
    page.getByRole('heading', { name: /^Why this wording/, exact: true }),
  ).toBeVisible()
  expect(geometry.rows).toHaveLength(2)
  const [vw, vh] = geometry.viewport as [number, number]
  for (const row of geometry.rows) {
    expect(row.left).toBeGreaterThanOrEqual(-1)
    expect(row.right).toBeLessThanOrEqual(vw + 1)
    expect(row.top).toBeGreaterThanOrEqual(-1)
    expect(row.bottom).toBeLessThanOrEqual(vh + 1)
  }
})
