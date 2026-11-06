import { chromium } from '@playwright/test'
import { WORKERS, appUrl, fakeUrl } from './ports'

type Stats = { requests: number; aborted: number; lastBodies: string[] }

async function stats(index: number): Promise<Stats> {
  const res = await fetch(`${fakeUrl(index)}/_stats`)
  return (await res.json()) as Stats
}

async function reset(index: number): Promise<void> {
  await fetch(`${fakeUrl(index)}/_reset`, { method: 'POST' })
}

// Proves, per app server, that translations reach that server's fake
// upstream before any test runs. This also warms the app server, so the
// first test does not pay for its cold start.
async function checkPair(index: number): Promise<void> {
  const html = await fetch(appUrl(index)).then(
    (res) => res.text(),
    (error: unknown) => {
      throw new Error(`App on ${appUrl(index)} is unreachable: ${error}`)
    },
  )
  if (!html.includes('data-testid="input-textarea"')) {
    throw new Error(
      `App on ${appUrl(index)} does not serve the translator page yet ` +
        '(no [data-testid="input-textarea"]); the e2e suite cannot run.',
    )
  }

  await reset(index)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ locale: 'en-US' })
    await page.goto(appUrl(index), { waitUntil: 'networkidle' })
    const nonce = Math.random().toString(36).slice(2, 10)
    const text = `Isolation check for the fake upstream [fx:plain] n${nonce}`
    const box = page.locator('[data-testid="input-textarea"]')
    await box.fill(text)
    const deadline = Date.now() + 20_000
    let seen: Stats = await stats(index)
    while (seen.requests === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      seen = await stats(index)
    }
    if (
      seen.requests === 0 ||
      !seen.lastBodies.some((body) => body.includes(`n${nonce}`))
    ) {
      throw new Error(
        `ISOLATION FAILURE: the fake OpenAI server on ${fakeUrl(index)} did not ` +
          `receive the translation typed into ${appUrl(index)}. The app may be ` +
          'talking to another upstream (real OpenAI?). Refusing to run.',
      )
    }
    await page.locator('[data-testid="main-translation"]').first().waitFor()
  } finally {
    await browser.close()
    await reset(index)
  }
}

export default async function globalSetup(): Promise<void> {
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => checkPair(i)))
}
