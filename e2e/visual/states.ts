// UI states the TS-vs-Go visual parity harness (tests/visual.spec.ts)
// captures. `npm run e2e:visual` first records every state from the TS app's
// production build as the baseline, then compares the Go app with it: the
// same screenshot (within the spec's threshold) and the same ARIA snapshot.
//
// Each UI task appends the states it adds. A state's setup starts from a
// blank page (the spec blocks web fonts first) and must leave the page in a
// deterministic, settled state: wait for the condition that ends the state,
// never for a fixed time.
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fillSource, openApp, waitForDone } from '../tests/helpers'
import type { Fake } from '../tests/helpers'

export type VisualState = {
  name: string
  /** Projects (by name) the state applies to; all when absent. */
  projects?: RegExp
  setup(page: Page, fake: Fake): Promise<void>
}

/** Fixed sentence input for `fixture`'s reply (e2e/fixtures/results). The
 * same text in every project keeps the screenshots comparable; the server
 * LRU returning a cached copy renders the same result. */
function visualText(fixture: string): string {
  return `[fx:${fixture}] How are you doing today, my friend?`
}

export const STATES: VisualState[] = [
  {
    name: 'empty',
    async setup(page) {
      await openApp(page)
    },
  },
  {
    name: 'sentence-done',
    async setup(page) {
      await openApp(page)
      await fillSource(page, visualText('visual'))
      await waitForDone(page)
      await expect(page.getByTestId('alternative-item')).toHaveCount(2)
    },
  },
  {
    name: 'error-provider',
    async setup(page, fake) {
      await openApp(page)
      await fillSource(page, visualText('error-provider'))
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 })
      expect(await fake.requests()).toBe(1)
    },
  },
  {
    // Reply context open with text: active toggle tone and the clear button.
    // No source text, so no request.
    name: 'context-open',
    async setup(page, fake) {
      await openApp(page)
      await page.getByTestId('context-toggle').click()
      await page
        .getByTestId('context-textarea')
        .fill('Are you free for lunch tomorrow?')
      await expect
        .poll(() => page.evaluate(() => sessionStorage.getItem('nt.context')))
        .toBe('"Are you free for lunch tomorrow?"')
      await expect(page.getByTestId('context-clear')).toBeVisible()
      await expect(page.getByTestId('context-toggle')).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      await expect(page.getByTestId('context-toggle')).toHaveClass(
        /bg-accent-soft/,
      )
      expect(await fake.requests()).toBe(0)
    },
  },
  {
    // Mid-stream (skeleton.json hangs inside alternatives[1].text): main and
    // its explanation, the first alternative settled and the second still a
    // skeleton, the busy swap icon. Pulses are masked.
    name: 'streaming-skeleton',
    async setup(page, fake) {
      await openApp(page)
      await fillSource(page, visualText('skeleton'))
      await expect(page.locator('.alternative-skeleton')).toHaveCount(1, {
        timeout: 20_000,
      })
      await expect(page.getByTestId('alternative-item')).toHaveCount(1)
      await expect(page.locator('.main-explanation .section-tag')).toBeVisible()
      await expect(page.locator('.output-panel')).toHaveAttribute(
        'aria-busy',
        'true',
      )
      expect(await fake.requests()).toBe(1)
    },
  },
  {
    // Input over the 4,000-character limit: a local error with its hint and
    // no Retry; no request.
    name: 'error-input',
    async setup(page, fake) {
      await openApp(page)
      await fillSource(page, 'How are you doing today? '.repeat(161).trim())
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 })
      expect(await fake.requests()).toBe(0)
    },
  },
  {
    // A word result (word.json): the word-details trigger as main text,
    // alternatives with register tags and, in workspace/split/book layouts,
    // the complete dictionary in the reference pane.
    name: 'word-done',
    async setup(page) {
      await openApp(page)
      await fillSource(page, '[fx:word] thanks')
      await waitForDone(page)
      await expect(page.getByTestId('alternative-item')).toHaveCount(3)
      const layout = await page
        .locator('.translator-panels')
        .getAttribute('data-layout')
      if (['workspace', 'split', 'book'].includes(layout ?? ''))
        await expect(
          page.locator('.reference-panel .word-source-meta'),
        ).toContainText('cheers')
    },
  },
]
