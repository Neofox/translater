// Text typed before the client modules run (a slow first load). The
// textarea is plain server HTML, usable from first paint; app.js must give
// text typed before it ran the debounced run that typing would have
// scheduled. Text the browser restores on reload or back/forward (form
// restoration) must never start a paid run.
import type { Page, Request, Route } from '@playwright/test'
import {
  expect,
  fixture,
  sentence,
  source,
  test,
  waitForDone,
  waitForMain,
  waitForStats,
} from './helpers'

const APP_MODULE = '**/static/js/app.*.js'

/** Hold the entry module until `release()`; nothing runs before it. */
async function holdModules(page: Page) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route(APP_MODULE, async (route: Route) => {
    await gate
    await route.continue()
  })
  return release
}

/** Serve the page with the textarea's autocomplete="off" removed, so the
 * browser may restore its value. Observed (2026-11): neither engine restores
 * it on reload; on back/forward WebKit restores it even with
 * autocomplete="off" and before the modules run, Chromium only without the
 * attribute and after they ran. Only the navigation type keeps WebKit's
 * restored text from running. */
async function allowRestoration(page: Page) {
  await page.route(
    (url) => url.pathname === '/',
    async (route: Route) => {
      const response = await route.fetch()
      const body = (await response.text()).replace(
        /(<textarea[^>]*data-testid="input-textarea"[^>]*?) autocomplete="off"/,
        '$1',
      )
      await route.fulfill({ response, body })
    },
  )
}

/** Fields of every POST /translate the page sends, in order. */
function recordRuns(page: Page): Record<string, string>[] {
  const runs: Record<string, string>[] = []
  page.on('request', (request: Request) => {
    if (request.method() !== 'POST' || !request.url().endsWith('/translate'))
      return
    const body = request.postData() ?? ''
    const type = request.headers()['content-type'] ?? ''
    if (type.startsWith('multipart/form-data')) {
      const fields: Record<string, string> = {}
      for (const m of body.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g))
        fields[m[1]!] = m[2]!
      runs.push(fields)
    } else {
      runs.push(Object.fromEntries(new URLSearchParams(body)))
    }
  })
  return runs
}

const navigationType = (page: Page) =>
  page.evaluate(
    () =>
      (
        performance.getEntriesByType('navigation')[0] as
          PerformanceNavigationTiming | undefined
      )?.type ?? 'none',
  )

/** The modules have run: the composer sized the textarea inline. */
const modulesRan = (page: Page) =>
  expect(source(page)).toHaveAttribute('style', /height/, { timeout: 15_000 })

test('text typed before the modules run is translated once @core @engine', async ({
  page,
  fake,
}) => {
  const runs = recordRuns(page)
  const release = await holdModules(page)
  const text = sentence('plain')
  try {
    await page.goto('/', { waitUntil: 'commit' })
    await source(page).click()
    await page.keyboard.type(text)
    await expect(source(page)).toHaveValue(text)
    await page.waitForTimeout(300)
    expect(runs).toHaveLength(0)
  } finally {
    release()
  }
  await modulesRan(page)
  expect(await navigationType(page)).toBe('navigate')
  // The debounce applies from module init, as for a keystroke at that time.
  await page.waitForTimeout(400)
  expect(runs).toHaveLength(0)
  await expect.poll(() => runs.length, { timeout: 5_000 }).toBe(1)
  expect(runs[0]).toMatchObject({
    text,
    trigger: 'debounce',
    inputRevision: '1',
    supersedesRunId: '',
    intent: 'sentence',
  })
  await waitForMain(page, fixture('plain').result.main!)
  await waitForDone(page)
  await page.waitForTimeout(1_500)
  expect(runs).toHaveLength(1)
  expect(await fake.requests()).toBe(1)
})

/** Translate `text` normally, then return the request count. */
async function translate(page: Page, text: string) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await modulesRan(page)
  await source(page).fill(text)
  await waitForMain(page, fixture('plain').result.main!)
  await waitForDone(page)
}

for (const restorable of [false, true]) {
  const label = restorable ? ' (restoration allowed)' : ''

  test(`reload does not translate the field's text${label} @core @engine`, async ({
    page,
    fake,
  }, testInfo) => {
    if (restorable) await allowRestoration(page)
    const text = sentence('plain')
    await translate(page, text)
    await waitForStats(fake, (s) => s.requests === 1)
    const runs = recordRuns(page)
    await page.reload({ waitUntil: 'networkidle' })
    await modulesRan(page)
    const restored = await source(page).inputValue()
    const type = await navigationType(page)
    testInfo.annotations.push({
      type: 'reload',
      description: `navigation=${type} restored=${restored === text}`,
    })
    expect(type).toBe('reload')
    if (!restorable) expect(restored).toBe('')
    await page.waitForTimeout(1_500)
    expect(runs).toHaveLength(0)
    expect(await fake.requests()).toBe(1)
  })

  test(`back/forward does not translate the field's text${label} @core @engine`, async ({
    page,
    fake,
  }, testInfo) => {
    if (restorable) await allowRestoration(page)
    const text = sentence('plain')
    await translate(page, text)
    await waitForStats(fake, (s) => s.requests === 1)
    await page.evaluate(() =>
      addEventListener('pageshow', (event) => {
        ;(window as unknown as { ntPersisted?: boolean }).ntPersisted =
          event.persisted
      }),
    )
    const runs = recordRuns(page)
    await page.goto('about:blank')
    await page.goBack({ waitUntil: 'load' })
    await modulesRan(page)
    const restored = await source(page).inputValue()
    // A bfcache restore keeps the old document: its navigation entry still
    // says 'navigate', but the modules do not run again.
    const type = await navigationType(page)
    const bfcache = await page.evaluate(
      () =>
        (window as unknown as { ntPersisted?: boolean }).ntPersisted === true,
    )
    testInfo.annotations.push({
      type: 'back_forward',
      description: `navigation=${type} restored=${restored === text} bfcache=${bfcache}`,
    })
    if (!bfcache) expect(type).toBe('back_forward')
    await page.waitForTimeout(1_500)
    expect(runs).toHaveLength(0)
    expect(await fake.requests()).toBe(1)
  })
}
