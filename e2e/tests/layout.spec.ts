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
  source,
  test,
  translationResult,
  waitForDone,
} from './helpers'
import { installFakeVisualViewport } from '../perf/page-scripts'
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
  insets: Partial<Record<'left' | 'right' | 'bottom', number>>,
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

async function emulateFold(
  page: Page,
  fold: 'vertical' | 'horizontal' | null,
): Promise<CDPSession> {
  const { width, height } = page.viewportSize()!
  const cdp = await page.context().newCDPSession(page)
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
      displayFeature: { orientation: fold, offset: FOLD, maskLength: HINGE },
    }),
  })
  return cdp
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
  await emulateFold(page, 'vertical')
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
  await emulateFold(page, null)
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
  await emulateFold(page, 'horizontal')
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
  await emulateFold(page, null)
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
