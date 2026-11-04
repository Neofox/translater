// Workspace layout (@layout): the measured layout, its server-rendered first
// paint and the panel order. Ports of tests/browser/mobile.browser.tsx and
// useWorkspaceLayout.test.tsx cases that need a real browser.
import type {
  BrowserContextOptions,
  CDPSession,
  Locator,
  Page,
  Route,
} from '@playwright/test'
import {
  copyButton,
  expect,
  fillSource,
  fixture,
  listenButton,
  nonce,
  openApp,
  sentence,
  setUiLang,
  source,
  test,
  translationResult,
  waitForDone,
  waitForMain,
} from './helpers'
import { installFakeVisualViewport, layoutSnapshot } from '../perf/page-scripts'
import type { PageGlobals } from '../perf/page-scripts'

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
    const chips = [
      ...document.querySelectorAll<HTMLElement>('.language-chip-bar'),
    ]
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
          .filter(
            (e): e is HTMLElement =>
              e instanceof HTMLElement && e.checkVisibility(),
          )
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
        (url) =>
          url.origin === new URL(baseURL!).origin && url.pathname === '/',
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
    const options: BrowserContextOptions = {
      viewport,
      hasTouch,
      locale,
      reducedMotion,
      baseURL,
    }
    const ssrContext = await browser.newContext(options)
    let before: Awaited<ReturnType<typeof boxes>>
    try {
      const ssr = await ssrContext.newPage()
      await prepare(ssr)
      await ssr.route('**/*', (route) =>
        route.request().resourceType() === 'script'
          ? route.abort()
          : route.fallback(),
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
        expect(
          Math.abs(a[key] - b[key]),
          `${label} ${key}`,
        ).toBeLessThanOrEqual(1)
    }
    before.elements.forEach((box, i) =>
      close(box, after.elements[i]!, `element ${i}`),
    )
    before.chips.forEach((bar, i) =>
      bar.forEach((box, j) =>
        close(box, after.chips[i]![j]!, `chip ${i}/${j}`),
      ),
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
    const at = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect()
    return {
      source: at('.input-panel'),
      result: at('.output-panel'),
      textarea: at('[data-testid="input-textarea"]'),
      footer: at('.composer-actions'),
      why: at('.detail-why'),
      actions: at('.primary-result-actions'),
      alternatives: at('.detail-alternatives'),
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

// ----- Ports of tests/browser/mobile.browser.tsx layout cases ---------------

type Rect = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

async function rect(target: Locator): Promise<Rect> {
  return target.evaluate((e) => {
    const { left, right, top, bottom, width, height } =
      e.getBoundingClientRect()
    return { left, right, top, bottom, width, height }
  })
}

/** Inside the layout viewport (assertWithinViewport). */
async function expectInViewport(target: Locator): Promise<void> {
  const [box, [vw, vh]] = await Promise.all([
    rect(target),
    target.page().evaluate(() => [innerWidth, innerHeight]),
  ])
  expect(box.left).toBeGreaterThanOrEqual(-1)
  expect(box.right).toBeLessThanOrEqual(vw! + 1)
  expect(box.top).toBeGreaterThanOrEqual(-1)
  expect(box.bottom).toBeLessThanOrEqual(vh! + 1)
}

/** A pointer at the horizontal centre of `target`, `dy` px below its top
 * (default: its centre), hits `target`. */
async function hits(target: Locator, dy = -1): Promise<boolean> {
  return target.evaluate((e, offset) => {
    const { left, top, width, height } = e.getBoundingClientRect()
    const hit = document.elementFromPoint(
      left + width / 2,
      top + (offset < 0 ? height / 2 : offset),
    )
    return Boolean(hit && e.contains(hit))
  }, dy)
}

/** Safe-area insets set on the shell (as the TS tests do), then re-measured. */
async function safeArea(
  page: Page,
  insets: Partial<Record<'top' | 'left' | 'right' | 'bottom', number>>,
): Promise<void> {
  await page.evaluate((sides) => {
    const app = document.querySelector<HTMLElement>('.app-shell')!
    for (const [side, px] of Object.entries(sides))
      app.style.setProperty(`--safe-area-${side}`, `${px}px`)
    window.dispatchEvent(new Event('resize'))
  }, insets)
}

/** The simulated software keyboard (installFakeVisualViewport): the visual
 * viewport's height and offsetTop. */
async function keyboard(page: Page, height: number, top = 0): Promise<void> {
  await page.evaluate(
    ([h, t]) => (window as unknown as PageGlobals).__keyboard!.set(h!, t!),
    [height, top],
  )
}

/** Safari's pan: offsetTop changes and only `scroll` fires. */
async function pan(page: Page, top: number): Promise<void> {
  await page.evaluate(
    (t) => (window as unknown as PageGlobals).__keyboard!.pan(t),
    top,
  )
}

async function withFakeViewport(page: Page): Promise<void> {
  await page.addInitScript(installFakeVisualViewport)
}

type EditorState = {
  same: boolean
  focused: boolean
  caret: [number, number]
  value: string
}

/** Focuses the textarea with a selection and marks the node, so later
 * reads can check its identity. */
async function markEditor(page: Page, start: number, end: number) {
  await page.evaluate(
    ([from, to]) => {
      const ta = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="input-textarea"]',
      )!
      ;(window as unknown as { __ta: Element }).__ta = ta
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(from!, to!)
    },
    [start, end],
  )
}

async function editor(page: Page): Promise<EditorState> {
  return page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    return {
      same: ta === (window as unknown as { __ta: Element }).__ta,
      focused: document.activeElement === ta,
      caret: [ta.selectionStart, ta.selectionEnd] as [number, number],
      value: ta.value,
    }
  })
}

const LONG_SOURCE =
  'Thanks again for helping me settle into Seoul.\n\nI have been trying to practice Korean every day, but I still get nervous when conversations move quickly. If you are free this weekend, would you like to grab coffee and take a walk? There is no rush to decide; just let me know what works best for you.'

function shell(page: Page): Locator {
  return page.locator('.app-shell')
}

test('workspace to Duo resizing preserves the source node cursor and applied context @layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1512, height: 982 })
  await openApp(page)
  await page.getByTestId('context-toggle').click()
  await page
    .getByTestId('context-textarea')
    .fill('A friend asking about the weekend.')
  const text = 'Keep this unfinished conversation turn.'
  await fillSource(page, text)
  await markEditor(page, 5, 14)
  for (const [width, height, mode] of [
    [382, 580, 'stack'],
    [736, 594, 'split'],
    [1512, 982, 'workspace'],
  ] as const) {
    await page.setViewportSize({ width, height })
    await expect(panels(page)).toHaveAttribute('data-layout', mode)
    expect(await editor(page)).toEqual({
      same: true,
      focused: true,
      caret: [5, 14],
      value: text,
    })
    await expect(page.getByTestId('context-textarea')).toHaveValue(
      'A friend asking about the weekend.',
    )
  }
})

test('wide workspaces put excess space outside and align tone and mirrored actions @layout', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width !== 1512, 'macbook-14 only (as TS)')
  await openApp(page)
  await fillSource(page, `${fixture('word').match} thanks`)
  await waitForDone(page)
  for (const width of [1280, 1512, 1728, 2048]) {
    await page.setViewportSize({ width, height: 982 })
    await expect(shell(page)).toHaveAttribute('data-layout', 'workspace')
    await expect
      .poll(async () => (await rect(shell(page))).width)
      .toBe(Math.min(width, 1536))
    const app = await rect(shell(page))
    expect(Math.abs(app.left - (width - app.width) / 2)).toBeLessThanOrEqual(1)
    const result = await rect(page.getByTestId('main-translation'))
    const tone = await rect(page.locator('.mode-segment'))
    expect(Math.abs(tone.left - result.left)).toBeLessThanOrEqual(1)
    const paste = await rect(page.getByTestId('paste-input'))
    const clear = await rect(page.getByTestId('clear-input'))
    const copy = await rect(copyButton(page))
    const languages = await rect(page.locator('[aria-label="Source language"]'))
    const textarea = await rect(source(page))
    expect(Math.abs(paste.top - copy.top)).toBeLessThanOrEqual(1)
    expect(Math.abs(clear.top - copy.top)).toBeLessThanOrEqual(1)
    expect(languages.right).toBeLessThanOrEqual(paste.left)
    expect(clear.bottom).toBeLessThanOrEqual(textarea.top)
    const output = await rect(page.locator('.output-panel'))
    const content = await rect(page.locator('.result-content'))
    expect(output.right - content.right).toBeLessThanOrEqual(32)
  }
})

test('Duo landscape uses source-side notes without changing pane order @layout', async ({
  page,
}) => {
  const { width, height } = page.viewportSize()!
  test.skip(width >= 1100 || width <= height, 'split landscape only')
  await openApp(page)
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  const input = await rect(page.locator('.input-panel'))
  const output = await rect(page.locator('.output-panel'))
  expect(input.right).toBeLessThanOrEqual(output.left + 1)
  // Go parks the pane in a hidden dock instead of unmounting it: check
  // where it is and that it shows, not only that it exists.
  const reference = page.locator('.input-panel > .reference-panel')
  await expect(reference).toHaveCount(1)
  await expect(reference).toBeVisible()
  await expect(page.locator('.reference-panel .detail-why')).toHaveCount(0)
  await expect(page.locator('.output-panel .detail-why')).toHaveCount(1)
  await expect(
    page.getByText(fixture('default').result.rationale!, { exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('paste-input')).toBeVisible()
  await expect(page.getByTestId('clear-input')).toBeVisible()
})

for (const state of ['empty', 'translated', 'long'] as const) {
  test(`split source and result actions share a bottom dock for ${state} turns @layout`, async ({
    page,
  }) => {
    test.skip(page.viewportSize()!.width >= 1100, 'compact projects')
    await openApp(page)
    if (state !== 'empty') {
      await fillSource(
        page,
        state === 'long'
          ? `${LONG_SOURCE} ${fixture('learn-long').match} ${nonce()}`
          : sentence('default'),
      )
      await waitForDone(page)
    }
    await markEditor(page, 0, 0)
    for (const [width, height] of [
      [580, 382],
      [736, 594],
      [960, 548],
    ] as const) {
      await page.setViewportSize({ width, height })
      await expect(shell(page)).toHaveAttribute('data-layout', 'split')
      await expect
        .poll(async () => (await rect(shell(page))).height)
        .toBe(height)
      const copy = await rect(copyButton(page))
      for (const id of ['paste-input', 'clear-input', 'context-toggle']) {
        const control = page.getByTestId(id)
        expect(
          Math.abs((await rect(control)).top - copy.top),
          `${id} top`,
        ).toBeLessThanOrEqual(1)
        await expectInViewport(control)
        expect(await hits(control, 22), `${id} hit`).toBe(true)
      }
      expect((await editor(page)).same).toBe(true)
    }
  })
}

test('Paste Clear and the main result actions remain visible and touch sized @layout', async ({
  page,
}) => {
  await openApp(page)
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  await expect(listenButton(page)).toBeVisible()
  for (const control of [
    page.getByTestId('paste-input'),
    page.getByTestId('clear-input'),
    copyButton(page),
  ]) {
    await expectInViewport(control)
    const box = await rect(control)
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('A workspace keeps long source and result controls above the safe bottom edge @layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 760 })
  await openApp(page)
  const line = 'Please translate this sentence.'
  await fillSource(
    page,
    `${Array(40).fill(line).join('\n')}\n${fixture('learn-long').match} ${nonce()}`,
  )
  await waitForDone(page)
  await safeArea(page, { left: 20, right: 64, bottom: 34 })
  await expect(panels(page)).toHaveAttribute('data-layout', 'workspace')
  const scrolls = await page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    const reference = document.querySelector<HTMLElement>(
      '.input-panel .reference-scroll',
    )
    const out = {
      input: input.scrollHeight > input.clientHeight,
      reference: reference
        ? [reference.clientHeight, reference.scrollHeight]
        : null,
    }
    input.scrollTop = input.scrollHeight
    if (reference) reference.scrollTop = reference.scrollHeight
    return out
  })
  expect(scrolls.input).toBe(true)
  expect(scrolls.reference).not.toBeNull()
  const [clientHeight, scrollHeight] = scrolls.reference!
  expect(clientHeight).toBeGreaterThan(160)
  expect(scrollHeight).toBeGreaterThan(clientHeight!)
  const pane = await rect(page.locator('.input-panel'))
  for (const id of ['paste-input', 'clear-input']) {
    const control = page.getByTestId(id)
    await expectInViewport(control)
    const box = await rect(control)
    expect(box.bottom).toBeLessThanOrEqual(760 - 34)
    expect(box.left).toBeGreaterThanOrEqual(20)
    expect(box.right).toBeLessThanOrEqual(pane.right)
  }
  await expectInViewport(copyButton(page))
  const copy = await rect(copyButton(page))
  expect(copy.bottom).toBeLessThanOrEqual(760 - 34)
  expect(copy.right).toBeLessThanOrEqual(1280 - 64)
  await translationResult(page).evaluate((e) => {
    e.scrollTop = e.scrollHeight
  })
  await expect
    .poll(() => translationResult(page).evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0)
  expect((await rect(copyButton(page))).top).toBe(copy.top)
  await expectInViewport(copyButton(page))
  await markEditor(page, 0, 0)
  await page.getByTestId('clear-input').click()
  await expect(source(page)).toHaveValue('')
  expect((await editor(page)).focused).toBe(true)
})

test('mobile multiline source stays expanded while typing and after the result arrives @layout', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width >= 560, 'narrow phones only')
  await openApp(page)
  await fillSource(page, `First line\nSecond line\nThird line ${nonce()}`)
  const height = () => rect(source(page)).then((box) => box.height)
  expect(await source(page).evaluate((e) => getComputedStyle(e).fontSize)).toBe(
    '18px',
  )
  expect(await height()).toBeGreaterThanOrEqual(90)
  await markEditor(page, 12, 15)
  await waitForDone(page)
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    caret: [12, 15],
  })
  expect(await height()).toBeGreaterThanOrEqual(90)
})

test('Return adds a line even with a pending translation @layout', async ({
  page,
  fake,
}) => {
  await openApp(page)
  await fillSource(page, `First line ${nonce()}`)
  const length = (await source(page).inputValue()).length
  await markEditor(page, length, length)
  // Still inside the debounce: the run is pending.
  await page.keyboard.press('Enter')
  await expect(source(page)).toHaveValue(/^First line n\w+\n$/)
  expect(await editor(page)).toMatchObject({ same: true, focused: true })
  expect(await fake.requests()).toBe(0)
})

// ----- Folded phones: viewport and software-keyboard changes ----------------
// Ports of the TS "folded" cases, which change the viewport and a stubbed
// visualViewport (no posture). Posture itself is emulated further below.

for (const withKeyboard of [false, true]) {
  test(`folded translation keeps the editor expanded without a collapse control (keyboard ${withKeyboard}) @layout`, async ({
    page,
  }) => {
    await withFakeViewport(page)
    await page.setViewportSize({ width: 440, height: 640 })
    await openApp(page)
    await safeArea(page, { right: 80, bottom: 34 })
    await fillSource(page, `${fixture('word').match} thanks`)
    await markEditor(page, 3, 6)
    if (withKeyboard) await keyboard(page, 300)
    await waitForDone(page)
    const input = page.locator('.input-panel')
    await expect(input).not.toHaveAttribute('data-source-compact')
    expect((await rect(input)).height).toBeLessThanOrEqual(
      withKeyboard ? 180 : 300,
    )
    expect(await editor(page)).toMatchObject({
      same: true,
      focused: true,
      caret: [3, 6],
    })
    const composer = await rect(page.locator('.composer'))
    expect(composer.left).toBeGreaterThanOrEqual(12)
    expect(composer.height).toBeGreaterThan(110)
    expect(composer.bottom).toBeLessThanOrEqual((await rect(input)).bottom)
    expect(composer.right).toBeLessThanOrEqual(440 - 80 - 12)
    for (const control of [copyButton(page), listenButton(page)]) {
      expect(
        await control.evaluate(
          (e) => getComputedStyle(e.querySelector('span')!).display,
        ),
      ).toBe('none')
      const box = await rect(control)
      expect(box.width).toBeLessThanOrEqual(48)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
    const first = page.getByTestId('alternative-item').first()
    if (withKeyboard)
      await first.evaluate((e) => e.scrollIntoView({ block: 'nearest' }))
    const altText = first.getByText(
      (
        fixture('word').result.alternativeTranslations as Array<{
          text: string
        }>
      )[0]!.text,
      { exact: true },
    )
    await expect(altText).toBeVisible()
    expect((await rect(altText)).bottom).toBeLessThanOrEqual(
      (await rect(translationResult(page))).bottom,
    )
    expect(await first.evaluate((e) => e.closest('[hidden]'))).toBeNull()
    await expect(page.locator('.output-panel .detail-learning')).toHaveCount(0)
    expect(
      await first.evaluate((e) =>
        e.querySelector('.copy-button')!.textContent.trim(),
      ),
    ).toBe('')
    await expectInViewport(copyButton(page))
    await expect(page.getByTestId('source-expand')).toHaveCount(0)
    expect((await editor(page)).same).toBe(true)
    await page.getByTestId('context-toggle').click()
    await page.getByTestId('context-textarea').fill('A friendly greeting.')
    await page.getByTestId('context-toggle').click()
    await page.getByTestId('context-toggle').click()
    await expect(page.getByTestId('context-textarea')).toHaveValue(
      'A friendly greeting.',
    )
    await page.getByTestId('clear-input').click()
    await expect(source(page)).toHaveValue('')
    expect(await editor(page)).toMatchObject({ same: true, focused: true })
  })
}

test('folded keyboard editor has a continuous surface and named actions @layout', async ({
  page,
}) => {
  await withFakeViewport(page)
  await page.setViewportSize({ width: 440, height: 640 })
  await openApp(page)
  await fillSource(page, `${fixture('word').match} thanks`)
  await waitForDone(page)
  await safeArea(page, { right: 80 })
  await markEditor(page, 0, 0)
  await keyboard(page, 300)
  await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
  await fillSource(page, 'Hello\nSecond line')
  const composer = page.locator('.composer')
  expect(
    await composer.evaluate((e) => {
      const style = getComputedStyle(e)
      return [style.backgroundColor, style.borderTopWidth]
    }),
  ).toEqual(['rgba(0, 0, 0, 0)', '0px'])
  await expect(page.getByTestId('source-expand')).toHaveCount(0)
  await expect(
    page.getByTestId('context-toggle').getByText('Context', { exact: true }),
  ).toBeVisible()
  for (const id of ['paste-input', 'clear-input', 'context-toggle'])
    await expectInViewport(page.getByTestId(id))
  expect((await rect(source(page))).height).toBeGreaterThanOrEqual(76)
  expect((await editor(page)).focused).toBe(true)
})

for (const withKeyboard of [false, true]) {
  test(`folding and unfolding preserve multiline editing and reachable actions (keyboard ${withKeyboard}) @layout`, async ({
    page,
  }) => {
    await withFakeViewport(page)
    await page.setViewportSize({ width: 382, height: 580 })
    await openApp(page)
    const text = `First line to translate.\nSecond line to edit.\nThird line stays here. ${nonce()}`
    await fillSource(page, text)
    await waitForDone(page)
    await markEditor(page, 12, 15)
    await safeArea(page, { bottom: 34 })
    for (const [width, height, mode] of [
      [382, 580, 'stack'],
      [594, 736, 'stack'],
      [736, 594, 'split'],
      [580, 382, 'split'],
      [382, 580, 'stack'],
    ] as const) {
      const visible = withKeyboard ? Math.round(height * 0.5) : height
      await keyboard(page, visible)
      await page.setViewportSize({ width, height })
      await keyboard(page, visible)
      await expect(shell(page)).toHaveAttribute('data-layout', mode)
      await expect
        .poll(async () => Math.round((await rect(shell(page))).height))
        .toBe(visible)
      if (withKeyboard)
        await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
      else await expect(shell(page)).not.toHaveAttribute('data-keyboard')
      expect(await editor(page)).toEqual({
        same: true,
        focused: true,
        caret: [12, 15],
        value: text,
      })
      expect(
        await source(page).evaluate((e) => getComputedStyle(e).fontSize),
      ).toBe('18px')
      expect((await rect(source(page))).height).toBeGreaterThanOrEqual(76)
      await expect(page.getByTestId('source-expand')).toHaveCount(0)
      if (mode === 'split') {
        const paste = await rect(page.getByTestId('paste-input'))
        const copy = await rect(copyButton(page))
        expect(Math.abs(paste.top - copy.top)).toBeLessThanOrEqual(1)
      }
      for (const [name, control] of [
        ['paste', page.getByTestId('paste-input')],
        ['clear', page.getByTestId('clear-input')],
        ['context', page.getByTestId('context-toggle')],
        ['copy', copyButton(page)],
        ['listen', listenButton(page)],
      ] as const) {
        const box = await rect(control)
        const label = `${name} at ${width}x${height}`
        expect(box.width, label).toBeGreaterThanOrEqual(44)
        expect(box.height, label).toBeGreaterThanOrEqual(44)
        expect(box.top, label).toBeGreaterThanOrEqual(0)
        expect(box.bottom, label).toBeLessThanOrEqual(
          visible - (withKeyboard ? 0 : 34),
        )
        expect(box.left, label).toBeGreaterThanOrEqual(0)
        expect(box.right, label).toBeLessThanOrEqual(width)
        expect(await hits(control), label).toBe(true)
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width)
    }
    await keyboard(page, 580)
    await expect(shell(page)).not.toHaveAttribute('data-keyboard')
    expect(await editor(page)).toMatchObject({
      same: true,
      focused: true,
      caret: [12, 15],
    })
  })
}

// ----- Fold postures (Chromium) ---------------------------------------------
// Chromium emulates a folded device through CDP: the posture override makes
// `(device-posture: folded)` match, and a display feature in the device
// metrics override splits the viewport into two segments (a vertical fold
// line gives horizontal-viewport-segments: 2, i.e. book; a horizontal one
// gives vertical-viewport-segments: 2, i.e. laptop).
// Emulation.setDisplayFeaturesOverride alone yields no segments in this
// Chromium. WebKit has no such emulation: its fold layouts stay a manual
// check. Sizes are a Surface Duo's: two 540 px segments and a 34 px hinge.

const FOLD = 540
const HINGE = 34

/** Runs `cleanup` when the current test ends, pass or fail. */
function onTestEnd(cleanup: () => Promise<unknown>): void {
  cleanups.push(cleanup)
}
const cleanups: Array<() => Promise<unknown>> = []
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => {})
})

/** Folds (or, with `fold` null, unfolds) the page through one CDP session:
 * overrides belong to the session that set them, so the caller opens it once
 * and detaches it when the test ends. */
async function emulateFold(
  cdp: CDPSession,
  page: Page,
  fold: 'vertical' | 'horizontal' | null,
  offset = FOLD,
  maskLength = HINGE,
): Promise<void> {
  const { width, height } = page.viewportSize()!
  if (fold)
    await cdp.send('Emulation.setDevicePostureOverride', {
      posture: { type: 'folded' },
    })
  else await cdp.send('Emulation.clearDevicePostureOverride')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    ...(fold && {
      displayFeature: { orientation: fold, offset, maskLength },
    }),
  })
}

async function translatedAndMarked(page: Page): Promise<void> {
  await openApp(page)
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  await markEditor(page, 5, 9)
}

test('book posture places source and result on their own segments @layout', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'posture emulation is Chromium-only')
  await page.setViewportSize({ width: 2 * FOLD + HINGE, height: 720 })
  await translatedAndMarked(page)
  await expect(panels(page)).toHaveAttribute('data-layout', 'workspace')
  const cdp = await page.context().newCDPSession(page)
  onTestEnd(() => cdp.detach())
  await emulateFold(cdp, page, 'vertical')
  for (const el of [panels(page), shell(page)])
    await expect(el).toHaveAttribute('data-layout', 'book')
  await expect(panels(page)).not.toHaveAttribute('data-desktop')
  await expect(panels(page)).not.toHaveAttribute('data-result-first')
  expect(
    await panels(page).evaluate((e) => e.firstElementChild!.className),
  ).toBe('input-panel')
  const input = await rect(page.locator('.input-panel'))
  const output = await rect(page.locator('.output-panel'))
  expect(Math.abs(input.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(input.right - FOLD)).toBeLessThanOrEqual(1)
  expect(Math.abs(output.left - (FOLD + HINGE))).toBeLessThanOrEqual(1)
  await expect(page.locator('.input-panel > .reference-panel')).toBeVisible()
  expect(
    await panels(page).evaluate((e) =>
      e.style.getPropertyValue('--panels-top'),
    ),
  ).toBe('')
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    caret: [5, 9],
  })
  await emulateFold(cdp, page, null)
  await expect(panels(page)).toHaveAttribute('data-layout', 'workspace')
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    caret: [5, 9],
  })
})

test('laptop posture puts the result above the fold below the measured header @layout', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'posture emulation is Chromium-only')
  await page.setViewportSize({ width: 720, height: 2 * FOLD + HINGE })
  await translatedAndMarked(page)
  await expect(panels(page)).toHaveAttribute('data-layout', 'stack')
  const cdp = await page.context().newCDPSession(page)
  onTestEnd(() => cdp.detach())
  await emulateFold(cdp, page, 'horizontal')
  for (const el of [panels(page), shell(page)])
    await expect(el).toHaveAttribute('data-layout', 'laptop')
  await expect(panels(page)).toHaveAttribute('data-result-first', 'true')
  expect(
    await panels(page).evaluate((e) => e.firstElementChild!.className),
  ).toBe('output-panel')
  // The first row ends at the fold: its height subtracts the panels' top,
  // measured below the header.
  const top = await panels(page).evaluate((e) => [
    e.style.getPropertyValue('--panels-top'),
    `${e.getBoundingClientRect().top + window.scrollY}px`,
  ])
  expect(top[0]).toBe(top[1])
  expect(parseFloat(top[0]!)).toBeGreaterThan(0)
  const output = await rect(page.locator('.output-panel'))
  const input = await rect(page.locator('.input-panel'))
  expect(Math.abs(output.bottom - FOLD)).toBeLessThanOrEqual(1)
  expect(Math.abs(input.top - (FOLD + HINGE))).toBeLessThanOrEqual(1)
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    caret: [5, 9],
  })
  await emulateFold(cdp, page, null)
  await expect(panels(page)).toHaveAttribute('data-layout', 'stack')
  expect(
    await panels(page).evaluate((e) =>
      e.style.getPropertyValue('--panels-top'),
    ),
  ).toBe('')
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    caret: [5, 9],
  })
})

// ----- Keyboard and safe-area parity (Task 28) --------------------------------
// Ports of tests/browser/mobile.browser.tsx keyboard, safe-area and
// streaming-stability cases, plus the AGENTS.md keyboard rules that no TS
// test names (tight keyboard, entry scroll reset, two editable lines, short
// stacked target row). TS stubs a visualViewport and injects result states
// into a fixture; here the stub is installFakeVisualViewport (`set` fires
// resize and scroll, `pan` scroll only, as Safari does) and the states come
// from slow fake-upstream fixtures, snapshotted inside the page at the
// moment each state appears.

/** Tests that set their own viewport run on one project per engine: the
 * project only chooses the starting size, which they replace. */
function ownViewport(testInfo: { project: { name: string } }): void {
  test.skip(
    !/^(chromium|webkit)-portrait$/.test(testInfo.project.name),
    'sets its own viewport: one project per engine',
  )
}

/** `text` with the fixture's match and a nonce (the server LRU never
 * short-circuits the stream). */
function withFixture(text: string, name: string): string {
  return `${text} ${fixture(name).match} ${nonce()}`
}

/** Waits for every finite animation (settleResultMotion). */
async function settleMotion(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime ?? 0),
        )
        .map((animation) => animation.finished.catch(() => {})),
    ),
  )
}

/** Every target lies inside the visible band (and left of `right`). */
async function expectInBand(
  band: { top: number; bottom: number; right?: number },
  targets: Array<[string, Locator]>,
): Promise<void> {
  for (const [name, target] of targets) {
    const box = await rect(target)
    expect(box.top, `${name} top`).toBeGreaterThanOrEqual(band.top - 0.5)
    expect(box.bottom, `${name} bottom`).toBeLessThanOrEqual(band.bottom + 0.5)
    if (band.right !== undefined)
      expect(box.right, `${name} right`).toBeLessThanOrEqual(band.right + 0.5)
  }
}

const SAFARI_KEYBOARD = [
  {
    width: 440,
    height: 640,
    visible: 300,
    offset: 80,
    right: 80,
    top: 0,
    expected: 'stack',
  },
  {
    width: 594,
    height: 736,
    visible: 320,
    offset: 80,
    right: 0,
    top: 0,
    expected: 'stack',
  },
  {
    width: 960,
    height: 548,
    visible: 210,
    offset: 110,
    right: 0,
    top: 0,
    expected: 'split',
  },
  {
    width: 1280,
    height: 760,
    visible: 240,
    offset: 20,
    right: 64,
    top: 0,
    expected: 'workspace',
  },
  {
    width: 440,
    height: 640,
    visible: 300,
    offset: 0,
    right: 80,
    top: 47,
    expected: 'stack',
  },
  {
    width: 960,
    height: 548,
    visible: 210,
    offset: 0,
    right: 0,
    top: 47,
    expected: 'split',
  },
] as const

for (const c of SAFARI_KEYBOARD) {
  test(`Safari keyboard keeps ${c.width} × ${c.height} (offset ${c.offset}, top ${c.top}) in ${c.expected} with the main translation visible @layout`, async ({
    page,
  }, testInfo) => {
    ownViewport(testInfo)
    const { width, height, visible, offset, right, top, expected } = c
    await withFakeViewport(page)
    await page.setViewportSize({ width, height })
    await openApp(page)
    await fillSource(
      page,
      withFixture('Thanks for helping me today.', 'keyboard'),
    )
    await waitForDone(page)
    await safeArea(page, { right, bottom: 34, top })
    await expect(panels(page)).toHaveAttribute('data-layout', expected)
    const order = () =>
      panels(page).evaluate((e) =>
        [...e.children].map((child) => child.className),
      )
    const before = await order()
    await translationResult(page).evaluate((e) => {
      e.scrollTop = 250
    })
    await markEditor(page, 5, 10)
    const appHeight = () =>
      shell(page).evaluate((e) =>
        parseFloat(e.style.getPropertyValue('--app-height')),
      )
    for (let step = height - 50; step > visible; step -= 50) {
      await keyboard(page, step, 0)
      await expect.poll(appHeight).toBe(step)
      await expect(panels(page)).toHaveAttribute('data-layout', expected)
      // useWorkspaceLayout's keyboard threshold, from the pre-keyboard
      // height.
      if (height - step > Math.max(100, height * 0.2))
        await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
      else await expect(shell(page)).not.toHaveAttribute('data-keyboard')
    }
    await keyboard(page, visible, offset)
    await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
    await expect(panels(page)).toHaveAttribute('data-layout', expected)
    expect(await order()).toEqual(before)
    expect(await editor(page)).toMatchObject({
      same: true,
      focused: true,
      caret: [5, 10],
    })
    await expect.poll(async () => (await rect(shell(page))).top).toBe(offset)
    expect((await rect(shell(page))).height).toBe(visible)
    await expect
      .poll(() => translationResult(page).evaluate((e) => e.scrollTop))
      .toBe(0)
    const main = await rect(page.getByTestId('main-translation'))
    const copy = await rect(copyButton(page))
    expect(main.top).toBeGreaterThanOrEqual(Math.max(offset, top))
    if (copy.top < main.top) expect(copy.bottom).toBeLessThanOrEqual(main.top)
    else expect(main.bottom).toBeLessThanOrEqual(copy.top)
    await expectInBand(
      {
        top: Math.max(offset, top),
        bottom: offset + visible,
        right: width - right,
      },
      [
        ['copy', copyButton(page)],
        ['textarea', source(page)],
        ['paste', page.getByTestId('paste-input')],
        ['clear', page.getByTestId('clear-input')],
      ],
    )
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollHeight),
    ).toBeLessThanOrEqual(height)
    // Safari pans the visual viewport without resizing it.
    await pan(page, offset + 20)
    await expect
      .poll(async () => (await rect(shell(page))).top)
      .toBe(offset + 20)
    await page.getByTestId('context-toggle').click()
    const reply = page.getByTestId('context-textarea')
    await reply.fill('A friend is checking in.')
    await reply.evaluate((e) => e.scrollIntoView({ block: 'nearest' }))
    await expectInBand(
      { top: Math.max(offset + 20, top), bottom: offset + 20 + visible },
      [
        ['reply', reply],
        ['paste', page.getByTestId('paste-input')],
        ['clear', page.getByTestId('clear-input')],
      ],
    )
    await page.getByTestId('clear-input').click()
    expect(await editor(page)).toMatchObject({ same: true, focused: true })
    await expect(source(page)).toHaveValue('')
    await expect(page.getByTestId('context-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await page.getByTestId('context-toggle').click()
    await expect(page.getByTestId('context-textarea')).toHaveValue(
      'A friend is checking in.',
    )
    await keyboard(page, height, 0)
    await expect(shell(page)).not.toHaveAttribute('data-keyboard')
    await expect(panels(page)).toHaveAttribute('data-layout', expected)
    expect((await editor(page)).same).toBe(true)
    await expect.poll(async () => (await rect(shell(page))).top).toBe(0)
  })
}

// TS fakes the posture media queries; here Chromium's CDP posture and a
// display feature fold the 736 × 736 viewport through its middle, so the
// segments are real. WebKit has no posture emulation.
for (const posture of ['book', 'laptop'] as const) {
  for (const withKeyboard of [false, true]) {
    test(`fold posture ${posture} preserves the turn and reachable controls (keyboard ${withKeyboard}) @layout`, async ({
      page,
      browserName,
    }) => {
      test.skip(
        browserName !== 'chromium',
        'posture emulation is Chromium-only',
      )
      await withFakeViewport(page)
      await page.setViewportSize({ width: 736, height: 736 })
      await openApp(page)
      await safeArea(page, { bottom: 34 })
      const text = 'Keep this conversation while folding.'
      await fillSource(page, text)
      await markEditor(page, text.length, text.length)
      const cdp = await page.context().newCDPSession(page)
      onTestEnd(() => cdp.detach())
      await emulateFold(
        cdp,
        page,
        posture === 'book' ? 'vertical' : 'horizontal',
        (736 - HINGE) / 2,
      )
      await expect(panels(page)).toHaveAttribute('data-layout', posture)
      const visible = withKeyboard ? 300 : 736
      if (withKeyboard) {
        await keyboard(page, 300)
        await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
      }
      expect(await editor(page)).toMatchObject({ same: true, focused: true })
      for (const id of ['paste-input', 'clear-input'])
        await expectInViewport(page.getByTestId(id))
      const sourcePane = await rect(page.locator('.input-panel'))
      const resultPane = await rect(page.locator('.output-panel'))
      if (posture === 'book')
        expect(sourcePane.right).toBeLessThanOrEqual(resultPane.left)
      else expect(resultPane.bottom).toBeLessThanOrEqual(sourcePane.top)
      const copy = await rect(copyButton(page))
      expect(copy.bottom).toBeLessThanOrEqual(visible)
      // TS also asserts that Paste shares Copy's top in book posture. With
      // real segments that fails in both apps: it is the separate known-bug
      // test below.
      await keyboard(page, 736)
      await emulateFold(cdp, page, null)
      await expect(panels(page)).toHaveAttribute('data-layout', 'stack')
      await expect(source(page)).toHaveValue(text)
    })
  }
}

// KNOWN BUG, both apps (the stylesheet is shared): under a real book
// posture (CSS posture and segment queries matching, not only the JS
// layout), Paste and Clear land on the same box under the editor and leave
// the bottom dock that Copy uses. TS's fold test fakes only matchMedia, so
// its stylesheet never sees the posture and the case passes there. Found by
// Task 28; recorded, not fixed (a go.css fix would diverge from TS).
test('real book posture keeps Paste and Clear apart on the result dock baseline @layout', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'posture emulation is Chromium-only')
  test.fail(true, 'known in both apps: book posture source dock (Task 28)')
  await page.setViewportSize({ width: 736, height: 736 })
  await openApp(page)
  await fillSource(page, 'Keep this conversation while folding.')
  const cdp = await page.context().newCDPSession(page)
  onTestEnd(() => cdp.detach())
  await emulateFold(cdp, page, 'vertical', (736 - HINGE) / 2)
  await expect(panels(page)).toHaveAttribute('data-layout', 'book')
  const paste = await rect(page.getByTestId('paste-input'))
  const clear = await rect(page.getByTestId('clear-input'))
  const copy = await rect(copyButton(page))
  expect(
    paste.right <= clear.left ||
      clear.right <= paste.left ||
      paste.bottom <= clear.top ||
      clear.bottom <= paste.top,
    'Paste and Clear do not overlap',
  ).toBe(true)
  expect(Math.abs(paste.top - copy.top)).toBeLessThanOrEqual(1)
})

test('long results keep the main line, editor and caret inside the visible band through 50 px keyboard steps and a pan @layout', async ({
  page,
}) => {
  // The perf harness's keyboard invariant (layoutSnapshot): 50 px steps down
  // to half the height, then a Safari pan to 12.5 %. The TS test of a
  // similar name (0.85/0.70/0.55, offsetTop 12) is ported in
  // learning.spec.ts.
  await withFakeViewport(page)
  await openApp(page)
  await safeArea(page, { bottom: 20 })
  await fillSource(
    page,
    withFixture('How are you doing today my friend', 'learn-long'),
  )
  await waitForDone(page)
  await markEditor(page, 2, 8)
  const { height } = page.viewportSize()!
  const half = Math.round(height / 2)
  const snapshot = () =>
    page.evaluate(layoutSnapshot, {
      main: '[data-testid="main-translation"]',
      source: '[data-testid="input-textarea"]',
      band: null,
    })
  const inside = {
    mainVisible: true,
    textareaVisible: true,
    caretVisible: true,
    sourceFocused: true,
  }
  const steps: number[] = []
  for (let step = height - 50; step > half; step -= 50) steps.push(step)
  steps.push(half)
  for (const step of steps) {
    await keyboard(page, step, 0)
    await expect.poll(async () => (await rect(shell(page))).height).toBe(step)
    expect(await snapshot(), `visible ${step}`).toMatchObject(inside)
  }
  await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
  const offset = Math.round(height * 0.125)
  await pan(page, offset)
  await expect.poll(async () => (await rect(shell(page))).top).toBe(offset)
  expect(await snapshot()).toMatchObject(inside)
  expect(await editor(page)).toMatchObject({ same: true, caret: [2, 8] })
})

/** A visible height that is a keyboard on this project, and tight. */
function tightKeyboard(height: number): number {
  return Math.min(300, Math.floor(height / 2))
}

test('a tight keyboard hides the header and transfers the top inset to the shell @layout', async ({
  page,
}) => {
  await withFakeViewport(page)
  await openApp(page)
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  await safeArea(page, { top: 47 })
  const header = page.locator('.app-header')
  await expect(header).toBeVisible()
  await markEditor(page, 0, 0)
  const padding = () =>
    shell(page).evaluate((e) => getComputedStyle(e).paddingTop)
  const { height } = page.viewportSize()!
  const visible = tightKeyboard(height)
  await keyboard(page, visible)
  await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
  await expect(shell(page)).toHaveAttribute('data-tight', 'true')
  await expect(header).toBeHidden()
  await expect.poll(padding).toBe('47px')
  // Safari pans the page under the inset: only what remains is padded,
  // and never less than the 12 px floor of the tight keyboard rule.
  await pan(page, 20)
  await expect.poll(padding).toBe('27px')
  await pan(page, 60)
  await expect.poll(async () => (await rect(shell(page))).top).toBe(60)
  await expect.poll(padding).toBe('12px')
  await expectInBand({ top: 60, bottom: 60 + visible }, [
    ['textarea', source(page)],
    ['paste', page.getByTestId('paste-input')],
    ['clear', page.getByTestId('clear-input')],
  ])
  expect(await editor(page)).toMatchObject({ same: true, focused: true })
  // A keyboard that leaves room (not tight) keeps the header.
  const roomy = 400
  if (height - roomy > Math.max(100, height * 0.2)) {
    await keyboard(page, roomy, 0)
    await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
    await expect(shell(page)).not.toHaveAttribute('data-tight')
    await expect(header).toBeVisible()
    await expect.poll(padding).toBe('0px')
  }
  await keyboard(page, height, 0)
  await expect(shell(page)).not.toHaveAttribute('data-keyboard')
  await expect(header).toBeVisible()
})

test('keyboard entry resets the result scroll to the main translation @layout', async ({
  page,
}) => {
  test.skip(
    page.viewportSize()!.width >= 1100,
    'compact layouts: the desktop workspace has no software keyboard rules',
  )
  await withFakeViewport(page)
  await openApp(page)
  await fillSource(
    page,
    withFixture('Thanks for helping me today.', 'keyboard'),
  )
  await waitForDone(page)
  const result = translationResult(page)
  await result.evaluate((e) => {
    e.scrollTop = 250
  })
  await expect
    .poll(() => result.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0)
  await markEditor(page, 0, 0)
  const { height } = page.viewportSize()!
  const visible = Math.floor(height / 2)
  await keyboard(page, visible)
  await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
  await expect.poll(() => result.evaluate((e) => e.scrollTop)).toBe(0)
  // The compact layout settles over a frame or two after the resize.
  await expect
    .poll(() => hits(page.getByTestId('main-translation'), 4))
    .toBe(true)
  const main = await rect(page.getByTestId('main-translation'))
  expect(main.top).toBeGreaterThanOrEqual(0)
  expect(main.top).toBeLessThan(visible)
  // Only the keyboard's entry resets: a later resize keeps the reader's
  // scroll.
  await result.evaluate((e) => {
    e.scrollTop = 120
  })
  await keyboard(page, visible - 20)
  await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
  expect(await result.evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
})

test('keyboard layouts keep at least two editable source lines and sticky actions @layout', async ({
  page,
}) => {
  test.skip(
    page.viewportSize()!.width >= 1100,
    'compact layouts: the desktop workspace has no software keyboard rules',
  )
  await withFakeViewport(page)
  await openApp(page)
  const text = `First line to translate.\nSecond line to edit.\nThird line stays here.\nFourth line.\nFifth line ${nonce()}`
  await fillSource(page, text)
  await waitForDone(page)
  await markEditor(page, 12, 15)
  const { height } = page.viewportSize()!
  const visible = Math.floor(height / 2)
  await keyboard(page, visible)
  await expect(shell(page)).toHaveAttribute('data-keyboard', 'true')
  expect(
    await source(page).evaluate(
      (e) => e.clientHeight / parseFloat(getComputedStyle(e).lineHeight),
    ),
  ).toBeGreaterThanOrEqual(2)
  for (const selector of ['.composer-actions', '.composer-meta'])
    expect(
      await page
        .locator(selector)
        .evaluate((e) => getComputedStyle(e).position),
      selector,
    ).toBe('sticky')
  const band = { top: 0, bottom: visible }
  const actions: Array<[string, Locator]> = [
    ['paste', page.getByTestId('paste-input')],
    ['clear', page.getByTestId('clear-input')],
    ['context', page.getByTestId('context-toggle')],
  ]
  await expectInBand(band, [['textarea', source(page)], ...actions])
  for (const [name, control] of actions)
    expect(await hits(control), name).toBe(true)
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    caret: [12, 15],
  })
  // Scrolling the composer keeps its actions pinned at the bottom.
  await page.locator('.composer').evaluate((e) => {
    e.scrollTop = e.scrollHeight
  })
  await expectInBand(band, actions)
  for (const [name, control] of actions)
    expect(await hits(control), name).toBe(true)
})

test('short stacked windows hide the target-language row to keep main text tappable @layout', async ({
  page,
}, testInfo) => {
  ownViewport(testInfo)
  await page.setViewportSize({ width: 382, height: 420 })
  await openApp(page)
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  await expect(panels(page)).toHaveAttribute('data-layout', 'stack')
  await expect(panels(page)).toHaveAttribute('data-short', 'true')
  await expect(panels(page)).not.toHaveAttribute('data-tight')
  const target = page.locator('.output-panel > .target-toolbar')
  await expect(target).toBeVisible()
  await page.setViewportSize({ width: 382, height: 340 })
  await expect(panels(page)).toHaveAttribute('data-tight', 'true')
  await expect(panels(page)).toHaveAttribute('data-layout', 'stack')
  await expect(target).toBeHidden()
  const main = page.getByTestId('main-translation')
  await expect(main).toBeVisible()
  expect(await hits(main, 4)).toBe(true)
  await expectInViewport(main)
  await expectInViewport(copyButton(page))
  expect(await hits(copyButton(page))).toBe(true)
})

type Snap = { boxes: number[][]; hits: boolean[]; same: boolean }

test('main actions keep one stable slot while translation and explanation grow @layout', async ({
  page,
}) => {
  await openApp(page)
  await expect(copyButton(page)).toBeDisabled()
  await expect(listenButton(page)).toBeDisabled()
  await fillSource(page, withFixture('Thanks for helping me today.', 'grow'))
  // Each result state is recorded inside the page when it first appears:
  // the Copy, Listen and composer boxes, hit tests and node identity.
  await page.evaluate(() => {
    const selectors = [
      '[data-testid="output-toolbar"] [data-testid="copy-button"]',
      '[data-testid="output-toolbar"] [data-testid="listen-button"]',
      '.composer',
    ]
    const copy = document.querySelector<HTMLButtonElement>(selectors[0]!)!
    const listen = document.querySelector<HTMLButtonElement>(selectors[1]!)!
    const measure = () =>
      selectors.map((selector) => {
        const r = document.querySelector(selector)!.getBoundingClientRect()
        return [r.x, r.y, r.width, r.height]
      })
    const hit = (e: Element) => {
      const r = e.getBoundingClientRect()
      return e.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      )
    }
    const snap = (): Snap => ({
      boxes: measure(),
      hits: [hit(copy), hit(listen)],
      same:
        document.querySelector(selectors[0]!) === copy &&
        document.querySelector(selectors[1]!) === listen,
    })
    const states: Record<string, Snap> = { before: snap() }
    const w = window as unknown as {
      __states: Record<string, Snap>
      __snap: () => Snap
    }
    w.__states = states
    w.__snap = snap
    // Completion is measured once its result transition has settled (the
    // view-transition overlay would take the hit tests).
    const record = () => {
      const main =
        document.querySelector('[data-testid="main-translation"]')
          ?.textContent ?? ''
      const state = !listen.disabled
        ? null
        : !copy.disabled
          ? 'mainReady'
          : main.trim()
            ? 'partial'
            : null
      if (!state || states[state]) return
      states[state] = snap()
    }
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
  })
  await waitForDone(page)
  await settleMotion(page)
  const states = await page.evaluate((): Record<string, Snap> => {
    const w = window as unknown as {
      __states: Record<string, Snap>
      __snap: () => Snap
    }
    return { ...w.__states, done: w.__snap() }
  })
  expect(Object.keys(states).sort()).toEqual([
    'before',
    'done',
    'mainReady',
    'partial',
  ])
  const before = states.before!.boxes
  for (const [name, state] of Object.entries(states)) {
    expect(state.same, `${name} nodes`).toBe(true)
    expect(state.hits, `${name} hits`).toEqual([true, true])
    state.boxes.forEach((box, i) =>
      box.forEach((value, j) =>
        expect(
          Math.abs(value - before[i]![j]!),
          `${name} control ${i} [${j}]`,
        ).toBeLessThanOrEqual(1),
      ),
    )
  }
  for (const control of [copyButton(page), listenButton(page)])
    await expectInViewport(control)
  await fillSource(page, `${fixture('error-provider').match} ${nonce()}`)
  await expect(page.locator('.result-error')).toBeVisible()
  await expect(copyButton(page)).toBeDisabled()
  await expect(listenButton(page)).toBeDisabled()
})

test('stream completion keeps Copy, language controls and existing alternatives anchored @layout', async ({
  page,
}) => {
  await openApp(page)
  await fillSource(page, withFixture('Thanks for helping me today.', 'anchor'))
  // The fixture's last delta is the closing brace alone, one delay after
  // the rest: the whole result shows while the run is still streaming.
  // Go swaps the last alternative in only when the stream ends (allowed
  // difference, Task 16), so the anchored row is the first, finished one.
  const handle = await page.waitForFunction(
    () => {
      const toolbar = document.querySelector('[data-testid="output-toolbar"]')!
      const copy = toolbar.querySelector<HTMLButtonElement>(
        '[data-testid="copy-button"]',
      )!
      const listen = toolbar.querySelector<HTMLButtonElement>(
        '[data-testid="listen-button"]',
      )!
      const alternatives = document.querySelectorAll(
        '[data-testid="alternative-item"]',
      )
      if (
        copy.disabled ||
        !listen.disabled ||
        alternatives.length < 1 ||
        !alternatives[0]!.textContent.includes('A warmer thank you.')
      )
        return null
      const lang = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="target-toolbar"] [data-testid="lang-chip"]',
        ),
      ].find((chip) => chip.getAttribute('aria-label') === '한국어')!
      const refine = document.querySelector<HTMLButtonElement>(
        '[data-testid="refine-chip-softer"]',
      )!
      const anchored = [copy, lang, alternatives[0]!, listen, refine]
      ;(window as unknown as { __anchor: Element[] }).__anchor = anchored
      return {
        boxes: anchored.slice(0, 3).map((e) => {
          const r = e.getBoundingClientRect()
          return [r.x, r.y]
        }),
        refineDisabled: refine.disabled,
      }
    },
    undefined,
    { polling: 'raf', timeout: 20_000 },
  )
  const streaming = (await handle.jsonValue())!
  expect(streaming.refineDisabled).toBe(true)
  await waitForDone(page)
  await settleMotion(page)
  const after = await page.evaluate(() => {
    const [copy, lang, alt, listen, refine] = (
      window as unknown as { __anchor: Element[] }
    ).__anchor
    return {
      boxes: [copy!, lang!, alt!].map((e) => {
        const r = e.getBoundingClientRect()
        return [r.x, r.y]
      }),
      listen:
        document.querySelector(
          '[data-testid="output-toolbar"] [data-testid="listen-button"]',
        ) === listen,
      refine:
        document.querySelector('[data-testid="refine-chip-softer"]') === refine,
    }
  })
  await expect(listenButton(page)).toBeVisible()
  expect(after.listen).toBe(true)
  expect(after.refine).toBe(true)
  streaming.boxes.forEach((box, i) => {
    expect(
      Math.abs(box[0]! - after.boxes[i]![0]!),
      `${i} x`,
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(box[1]! - after.boxes[i]![1]!),
      `${i} y`,
    ).toBeLessThanOrEqual(1)
  })
})

test('wording placeholder uses its real text line height while main Copy stays available @layout', async ({
  page,
}) => {
  await openApp(page)
  await fillSource(
    page,
    withFixture('Thanks for helping me today.', 'placeholder'),
  )
  // Main has closed while the phrase details stream ahead of the
  // rationale: the explanation still shows its placeholder lines.
  const handle = await page.waitForFunction(
    () => {
      const copy = document.querySelector<HTMLButtonElement>(
        '[data-testid="output-toolbar"] [data-testid="copy-button"]',
      )!
      const skeleton = document.querySelector('.main-explanation-skeleton')
      if (copy.disabled || !skeleton?.checkVisibility()) return null
      const box = skeleton.closest('.main-explanation')!.getBoundingClientRect()
      return { copyTop: copy.getBoundingClientRect().top, height: box.height }
    },
    undefined,
    { polling: 'raf', timeout: 20_000 },
  )
  const ready = (await handle.jsonValue())!
  await expect(
    page.getByText('Natural wording.', { exact: true }),
  ).toBeVisible()
  await expect(copyButton(page)).toBeEnabled()
  expect(
    Math.abs(ready.copyTop - (await rect(copyButton(page))).top),
  ).toBeLessThanOrEqual(1)
  const why = page.locator('.main-explanation:visible')
  expect(await why.evaluate((e) => getComputedStyle(e).fontSize)).toBe('14px')
  expect(Math.abs(ready.height - (await rect(why)).height)).toBeLessThanOrEqual(
    1,
  )
  const main = await rect(page.getByTestId('main-translation'))
  expect((await rect(why)).top - main.bottom).toBeGreaterThanOrEqual(12)
})

test('Korean controls and a full input keep the conversation actions reachable @layout', async ({
  page,
}) => {
  await openApp(page)
  await setUiLang(page, 'ko')
  await expect(page.getByTestId('paste-input')).toContainText('붙여넣기')
  await expect(page.getByTestId('clear-input')).toContainText('지우기')
  await fillSource(page, 'a'.repeat(5001))
  for (const id of ['paste-input', 'clear-input'])
    await expectInViewport(page.getByTestId(id))
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.getByTestId('clear-input').click()
  await expect(source(page)).toHaveValue('')
})

test('source sizing keeps Clear reachable for long and short turns @layout', async ({
  page,
}) => {
  await openApp(page)
  const height = () =>
    source(page).evaluate((e) => (e as HTMLTextAreaElement).offsetHeight)
  await fillSource(page, 'Hi')
  const short = await height()
  await fillSource(page, LONG_SOURCE)
  const workspace =
    (await panels(page).getAttribute('data-layout')) === 'workspace'
  const { width: vw, height: vh } = page.viewportSize()!
  if (vh >= 460) expect(await height()).toBeGreaterThan(short)
  else expect(await height()).toBeGreaterThanOrEqual(short)
  await fillSource(page, 'Hi')
  expect(await height()).toBeLessThanOrEqual(short + 1)
  if (!workspace && vw >= 1100 && vh >= 640)
    expect(await height()).toBeLessThanOrEqual(60)
  await page.getByTestId('clear-input').click()
  await expect(source(page)).toHaveValue('')
  expect(await source(page).evaluate((e) => document.activeElement === e)).toBe(
    true,
  )
  await expect(page.getByTestId('paste-input')).toBeVisible()
  await expect(page.getByTestId('clear-input')).toBeVisible()
})

test('portrait keeps alternatives readable with an expanded multiline source @layout', async ({
  page,
}) => {
  const { width, height } = page.viewportSize()!
  test.skip(width >= 1100 || width > height, 'portrait only')
  await openApp(page)
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  const input = page.locator('.input-panel')
  await expect(input).not.toHaveAttribute('data-source-compact')
  expect((await rect(input)).height).toBeLessThanOrEqual(300)
  expect(
    await source(page).evaluate(
      (e) => e.clientHeight / parseFloat(getComputedStyle(e).lineHeight),
    ),
  ).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.output-panel .detail-alternatives')).toHaveCount(
    1,
  )
  await expect(page.locator('.output-panel .detail-learning')).toHaveCount(0)
  // Go keeps these mounted and hidden (allowed difference); TS unmounts them.
  await expect(page.locator('.learning-panel')).toBeHidden()
  await expect(page.locator('.reference-panel')).toBeHidden()
  await expect(
    page
      .getByTestId('alternative-item')
      .first()
      .getByRole('button', { name: 'Copy', exact: true }),
  ).toBeVisible()
})

test('landscape sentence notes use the card width without reserving bottom insets above the result @layout', async ({
  page,
}, testInfo) => {
  ownViewport(testInfo)
  await page.setViewportSize({ width: 960, height: 548 })
  await openApp(page)
  await fillSource(page, withFixture('Hello how are you', 'notes'))
  await waitForDone(page)
  await safeArea(page, { bottom: 34 })
  await expect(panels(page)).toHaveAttribute('data-layout', 'split')
  const editorPane = await rect(page.locator('.input-panel'))
  const target = await rect(page.getByTestId('target-toolbar'))
  expect(editorPane.right).toBeLessThanOrEqual(target.left)
  const card = page.getByTestId('alternative-item').first()
  expect((await rect(card.locator('.alternative-note'))).width).toBeGreaterThan(
    (await rect(card)).width * 0.8,
  )
  await settleMotion(page)
  const second = page
    .getByTestId('alternative-item')
    .getByText('안녕하세요, 잘 지내세요?', { exact: true })
  await second.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await expectInViewport(second)
  expect((await rect(copyButton(page))).bottom).toBeLessThanOrEqual(548 - 34)
})

test('wide result languages cannot overlap the reserved main actions near the breakpoint @layout', async ({
  page,
}, testInfo) => {
  ownViewport(testInfo)
  await page.setViewportSize({ width: 1200, height: 760 })
  await openApp(page)
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  await safeArea(page, { right: 80 })
  const bar = page.getByRole('group', { name: 'Target language', exact: true })
  await expect.poll(() => bar.evaluate((e) => e.clientWidth)).toBeLessThan(280)
  const more = bar.getByTestId('lang-more-trigger')
  expect((await rect(more)).right + 8).toBeLessThanOrEqual(
    (await rect(copyButton(page))).left,
  )
  expect(await hits(more)).toBe(true)
})

test('technical translation description has a quieter measure and clear spacing @layout', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width !== 1512, 'macbook-14 only (as TS)')
  await openApp(page)
  await fillSource(
    page,
    withFixture(
      "I'll put the split in a small helper under api/src/utils/",
      'technical',
    ),
  )
  await waitForDone(page)
  const why = page.locator('.main-explanation:visible')
  expect(await why.evaluate((e) => getComputedStyle(e).fontSize)).toBe('14px')
  const main = await rect(page.getByTestId('main-translation'))
  expect((await rect(why)).top - main.bottom).toBeGreaterThanOrEqual(12)
})

test('long text keeps source learning separate from output wording without a result focus ring @layout', async ({
  page,
}) => {
  await openApp(page)
  expect(LONG_SOURCE.length).toBe(300)
  await fillSource(page, withFixture(LONG_SOURCE, 'longtext'))
  await waitForMain(page, fixture('longtext').result.main!)
  await waitForDone(page)
  await expect(page.getByTestId('main-translation')).toBeVisible()
  const output = translationResult(page)
  expect(
    await output.evaluate((e) => {
      ;(e as HTMLElement).focus()
      const style = getComputedStyle(e)
      return [style.outlineStyle, style.boxShadow]
    }),
  ).toEqual(['none', 'none'])
  const { width, height } = page.viewportSize()!
  if (width < 640 && height >= 416) {
    const actions = await rect(
      page.getByTestId('output-toolbar').locator('.primary-result-actions'),
    )
    const text = await rect(page.getByTestId('main-translation'))
    if (text.bottom > actions.top)
      expect(actions.top).toBeGreaterThanOrEqual((await rect(output)).bottom)
  }
  await expectInViewport(copyButton(page))
  await expect(page.locator('.detail-learning')).toHaveCount(0)
})

test('aligned workspace keeps matching action boxes and usage with its translation @layout', async ({
  page,
}) => {
  await openApp(page)
  await fillSource(page, `${fixture('word').match} thanks`)
  await waitForDone(page)
  const actions = page.locator('.primary-result-actions')
  const copy = await rect(actions.locator('.copy-button'))
  const listen = await rect(actions.locator('.listen-button'))
  expect(Math.abs(copy.height - listen.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(copy.width - listen.width)).toBeLessThanOrEqual(1)
  await expect(actions.locator('kbd')).toHaveCount(0)
  const why = page.locator('.output-panel .detail-why')
  await expect(why).toContainText(
    fixture('word').result.primaryUsageNote as string,
  )
  expect(await why.evaluate((e) => e.closest('[hidden]'))).toBeNull()
  expect(await why.evaluate((e) => Boolean(e.closest('.result-scroll')))).toBe(
    true,
  )
  expect(
    await actions.evaluate((e) => Boolean(e.closest('.result-scroll'))),
  ).toBe(false)
  await expect(page.locator('.reference-panel .detail-why')).toHaveCount(0)
  // Go keeps the reference pane mounted in a hidden dock: only a visible
  // one counts as TS's mounted pane.
  if (await page.locator('.reference-panel').isVisible()) {
    await expect(
      page.locator('.reference-panel .word-source-meta'),
    ).not.toHaveCount(0)
    const sourcePane = await rect(page.locator('.input-panel'))
    const resultPane = await rect(page.locator('.output-panel'))
    expect(sourcePane.right).toBeLessThanOrEqual(resultPane.left + 1)
    const background = (selector: string) =>
      page
        .locator(selector)
        .evaluate((e) => getComputedStyle(e).backgroundColor)
    expect(await background('.input-panel')).toBe(
      await background('.output-panel'),
    )
  }
})

test('source surface stays stable while typing and controls keep keyboard focus @layout', async ({
  page,
}) => {
  await openApp(page)
  await fillSource(page, sentence('default'))
  await source(page).blur()
  const field = page.locator('.composer-field')
  const style = () =>
    field.evaluate((e) => {
      const s = getComputedStyle(e)
      return { border: s.borderColor, shadow: s.boxShadow }
    })
  const before = await style()
  await source(page).evaluate((e) => e.focus({ preventScroll: true }))
  const focused = await style()
  expect(focused.border).toBe(before.border)
  expect(focused.shadow).toBe('none')
  expect(
    await source(page).evaluate((e) => getComputedStyle(e).outlineStyle),
  ).toBe('none')
  await page.getByTestId('clear-input').click()
  expect(await source(page).evaluate((e) => document.activeElement === e)).toBe(
    true,
  )
})

const SAFE_AREAS = [
  { width: 440, height: 640, right: 80, bottom: 34 },
  { width: 382, height: 580, right: 48, bottom: 34 },
  { width: 640, height: 382, right: 0, bottom: 34 },
  { width: 640, height: 320, right: 0, bottom: 34 },
  { width: 640, height: 320, right: 80, bottom: 34 },
  { width: 440, height: 320, right: 80, bottom: 34 },
] as const

for (const { width, height, right, bottom } of SAFE_AREAS) {
  test(`Safari safe areas keep backgrounds full width and actions reachable at ${width} × ${height} (right ${right}) @layout`, async ({
    page,
  }, testInfo) => {
    ownViewport(testInfo)
    await page.setViewportSize({ width, height })
    await openApp(page)
    await fillSource(page, withFixture(LONG_SOURCE, 'longtext'))
    await waitForDone(page)
    await safeArea(page, { top: 12, right, bottom, left: 0 })
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.max(
            ...[...document.querySelectorAll('.input-panel,.output-panel')].map(
              (panel) => panel.getBoundingClientRect().right,
            ),
          ),
        ),
      )
      .toBe(width)
    expect((await rect(shell(page))).right).toBe(width)
    const context = await rect(page.getByTestId('context-toggle'))
    for (const selector of [
      '[data-testid="paste-input"]',
      '[data-testid="clear-input"]',
      '.app-settings',
      '[data-testid="output-toolbar"] .copy-button',
    ]) {
      const box = await rect(page.locator(selector))
      expect(box.right, selector).toBeLessThanOrEqual(width - right)
      expect(box.bottom, selector).toBeLessThanOrEqual(height - bottom)
      expect(box.left, selector).toBeGreaterThanOrEqual(0)
      if (selector.includes('clear-input'))
        expect(
          Math.max(
            0,
            Math.min(box.right, context.right) -
              Math.max(box.left, context.left),
          ) *
            Math.max(
              0,
              Math.min(box.bottom, context.bottom) -
                Math.max(box.top, context.top),
            ),
        ).toBe(0)
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    const copy = await rect(copyButton(page))
    expect(copy.bottom).toBeLessThanOrEqual(
      Math.min(
        height - bottom,
        (await rect(page.locator('.output-panel'))).bottom,
      ),
    )
    await page.getByTestId('clear-input').click()
    await expect(
      page.getByText('Your translation appears here.', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /try a|sample/i }),
    ).toHaveCount(0)
  })
}
