// Billed production smoke for a deployment (Task 30). It runs only with
// PROD_URL (playwright.config.ts excludes @prod otherwise, and CI runs only
// @core), talks to the real deployment (no fake upstream, no synthetic
// audio) and makes exactly one translation and one speech request:
//
//   PROD_URL=https://<domain> npx playwright test -c e2e --grep @prod \
//     --project chromium-macbook-14
//
// Optional: VERCEL_AUTOMATION_BYPASS_SECRET (Deployment Protection; sent
// only to the deployment's own origin) and PROD_SMOKE_TEXT (another
// synthetic sentence, e.g. when this one is already in a warm instance's
// LRU cache, which would replay the result in one burst).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PROD_URL = process.env.PROD_URL ?? ''
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? ''
// Synthetic, and not scripts/go smoke's default sentence (cmd/smoke), so
// the two never share an LRU entry.
const TEXT =
  process.env.PROD_SMOKE_TEXT ??
  'Could you send me the meeting notes when you get a chance?'

/** Gap between DOM observations that counts as separate stream arrivals. */
const GAP_MS = 50

type Sample = {
  t: number
  mainLength: number
  copyDisabled: boolean
  listenDisabled: boolean
  listen: 'idle' | 'loading' | 'playing'
}

// Reduced motion shows live main text directly (no grapheme interpolation,
// which could stretch one buffered burst over 100 ms and fake streaming)
// and skips the completion View Transition, whose overlay swallows taps.
test.use({ reducedMotion: 'reduce' })

/** Records every DOM change of the main text, Copy and Listen as a sample
 * (MutationObserver callbacks, so brief states like Listen's loading are
 * never missed). Content is reduced to a length. */
async function recordSamples(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: Sample[] = []
    ;(window as unknown as { __smoke: Sample[] }).__smoke = log
    const q = (selector: string) => document.querySelector(selector)
    const take = () => {
      const listen = q(
        '[data-testid="output-toolbar"] [data-testid="listen-button"]',
      )
      const copy = q(
        '[data-testid="output-toolbar"] [data-testid="copy-button"]',
      )
      const sample: Sample = {
        t: performance.now(),
        mainLength:
          q('[data-testid="main-translation"]')?.textContent.length ?? 0,
        copyDisabled: !copy || (copy as HTMLButtonElement).disabled,
        listenDisabled: !listen || (listen as HTMLButtonElement).disabled,
        listen:
          listen?.getAttribute('aria-busy') === 'true'
            ? 'loading'
            : listen?.getAttribute('aria-pressed') === 'true'
              ? 'playing'
              : 'idle',
      }
      const last = log.at(-1)
      if (
        !last ||
        last.mainLength !== sample.mainLength ||
        last.copyDisabled !== sample.copyDisabled ||
        last.listenDisabled !== sample.listenDisabled ||
        last.listen !== sample.listen
      )
        log.push(sample)
    }
    take()
    new MutationObserver(take).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-busy', 'aria-pressed'],
    })
  })
}

async function samples(page: Page): Promise<Sample[]> {
  return page.evaluate(
    () => (window as unknown as { __smoke: Sample[] }).__smoke,
  )
}

test('production: streams one translation and plays one real pronunciation @prod', async ({
  page,
}) => {
  test.skip(!PROD_URL, 'PROD_URL is not set')
  test.setTimeout(180_000)
  const origin = new URL(PROD_URL).origin

  if (BYPASS) {
    // Same-origin requests only: extraHTTPHeaders would also send the
    // secret to third-party origins (and trigger CORS preflights).
    await page.route(
      (url) => url.origin === origin,
      (route) =>
        route.continue({
          headers: {
            ...route.request().headers(),
            'x-vercel-protection-bypass': BYPASS,
          },
        }),
    )
  }

  const billed = { translate: 0, speech: 0 }
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== origin || request.method() !== 'POST') return
    if (url.pathname === '/translate') billed.translate++
    if (url.pathname === '/speech') billed.speech++
  })
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push(`${message.text()} @ ${message.location().url}`)
  })
  page.on('pageerror', (error) =>
    consoleErrors.push(`pageerror: ${error.message}`),
  )

  const response = await page.goto('/', { waitUntil: 'networkidle' })
  expect(response?.status(), 'GET / status').toBe(200)
  const headers = response?.headers() ?? {}
  expect(headers['cache-control']).toBe('private, no-store')
  expect(headers.vary).toMatch(/Cookie, Accept-Language/i)

  await page
    .locator(
      "[aria-label='Source language'] [data-testid='lang-chip'][data-value='en']",
    )
    .click()
  await page
    .locator(
      "[aria-label='Target language'] [data-testid='lang-chip'][data-value='ko']",
    )
    .click()
  await recordSamples(page)

  // One input event; the sentence-final period selects the 400 ms debounce.
  await page.getByTestId('input-textarea').fill(TEXT)
  const listen = page.locator(
    '[data-testid="output-toolbar"] [data-testid="listen-button"]',
  )
  await expect(listen, 'the whole result completes').toBeEnabled({
    timeout: 90_000,
  })

  const translated = await samples(page)
  const growth: Sample[] = []
  for (const s of translated) {
    const last = growth.at(-1)
    if (
      s.mainLength > (last?.mainLength ?? 0) &&
      (!last || s.t - last.t > GAP_MS)
    )
      growth.push(s)
  }
  expect(
    growth.length,
    `main text grew over ${growth.length} observations >${GAP_MS} ms apart ` +
      '(fewer: the stream was buffered, or the LRU answered; set PROD_SMOKE_TEXT)',
  ).toBeGreaterThanOrEqual(3)
  const copyAt = translated.find((s) => !s.copyDisabled && s.mainLength > 0)?.t
  const doneAt = translated.find((s) => !s.listenDisabled)?.t
  expect(copyAt, 'Copy enabled').toBeDefined()
  expect(doneAt, 'result done (Listen enabled)').toBeDefined()
  expect(copyAt!, 'Copy enabled before the result was done').toBeLessThan(
    doneAt!,
  )
  const timing = {
    copyAfterFirstText: Math.round(copyAt! - growth[0]!.t),
    doneAfterFirstText: Math.round(doneAt! - growth[0]!.t),
    growthObservations: growth.length,
  }

  await listen.click()
  // Pressed covers both loading and playing; then wait for the end.
  await expect(listen, 'Listen starts').toHaveAttribute('aria-pressed', 'true')
  await expect(listen, 'pronunciation plays to the end').toHaveAttribute(
    'aria-pressed',
    'false',
    { timeout: 120_000 },
  )
  await expect(listen).toHaveAttribute('aria-busy', 'false')
  // Samples since the result completed, from the tap's first loading state.
  const after = (await samples(page)).slice(translated.length)
  const tapped = after.findIndex((s) => s.listen !== 'idle')
  const played = tapped < 0 ? [] : after.slice(tapped)
  const states = played
    .map((s) => s.listen)
    .filter((state, i, all) => i === 0 || state !== all[i - 1])
  expect(states, 'Listen went loading → playing → idle').toEqual([
    'loading',
    'playing',
    'idle',
  ])
  await expect(page.getByRole('status').filter({ hasText: /./ })).toHaveCount(0)

  expect(billed, 'exactly one translation and one speech request').toEqual({
    translate: 1,
    speech: 1,
  })
  expect(consoleErrors, 'no console errors').toEqual([])
  const playingAt = played.find((s) => s.listen === 'playing')!.t
  const report = {
    ...timing,
    speechLoadingMs: Math.round(playingAt - played[0]!.t),
    speechPlayingMs: Math.round(played.at(-1)!.t - playingAt),
  }
  test
    .info()
    .annotations.push({ type: 'timings', description: JSON.stringify(report) })
  console.log(`[prod-smoke] ${JSON.stringify(report)}`)
})
