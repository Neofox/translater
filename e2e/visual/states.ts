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
import {
  fillSource,
  listenButton,
  openApp,
  waitForDone,
} from '../tests/helpers'
import type { Fake } from '../tests/helpers'
import { installSyntheticAudio } from '../tests/syntheticAudio'

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
    // Settings popover open (bottom-end below its trigger) with focus on the
    // dialog itself, as Floating UI leaves it. No request.
    name: 'settings-open',
    async setup(page, fake) {
      await openApp(page)
      await page.getByTestId('settings-button').click()
      const dialog = page.getByRole('dialog', { name: 'Settings' })
      await expect(
        dialog.getByRole('group', { name: 'UI language' }),
      ).toBeVisible()
      await expect(dialog).toBeFocused()
      await expect(page.getByTestId('settings-button')).toHaveAttribute(
        'aria-expanded',
        'true',
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
  {
    // Desktop workspace after activating the word trigger: the reference
    // heading names the headword and holds focus (its focus outline).
    name: 'reference-word',
    projects: /-(macbook-14|macbook-16|desktop-short)$/,
    async setup(page) {
      await openApp(page)
      await fillSource(page, '[fx:word] thanks')
      await waitForDone(page)
      await page.getByTestId('word-details-trigger').click()
      const heading = page.locator('.reference-heading')
      await expect(heading).toBeFocused()
      await expect(heading).toHaveText('Word details · thanks')
      await expect(
        page.locator('.reference-panel .word-source-meta'),
      ).toContainText('cheers')
    },
  },
  {
    // Every other layout (split and book included) opens the full-size
    // learning surface with the dictionary over the Copy/Listen dock.
    name: 'learning-word-open',
    projects: /-(portrait|landscape)$/,
    async setup(page) {
      await openApp(page)
      await fillSource(page, '[fx:word] thanks')
      await waitForDone(page)
      await page.getByTestId('word-details-trigger').click()
      const panel = page.getByTestId('learning-panel')
      await expect(
        panel.getByRole('button', { name: 'Close learning' }),
      ).toBeFocused()
      await expect(panel.locator('.word-source-meta')).toContainText('cheers')
    },
  },
  {
    // Main Listen tapped while the audio unlock is still pending (synthetic
    // audio holds resume): the active tone, spinner and Stop label. No
    // speech request is sent.
    name: 'listen-loading',
    async setup(page, fake) {
      await installSyntheticAudio(page, { holdResume: true })
      await listenTo(page)
      await expect(listenButton(page)).toHaveAttribute('aria-busy', 'true')
      expect((await fake.stats()).speechRequests).toBe(0)
    },
  },
  {
    // Main Listen playing: the fake's audio has arrived and synthetic audio
    // never ends it, so the Stop state holds.
    name: 'listen-playing',
    async setup(page, fake) {
      await installSyntheticAudio(page)
      await listenTo(page)
      await expect(listenButton(page)).toHaveAttribute('aria-busy', 'false')
      await expect(listenButton(page)).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(async () => (await fake.stats()).active).toBe(0)
      expect((await fake.stats()).speechRequests).toBe(1)
    },
  },
  {
    // A failed Listen (the fake's speech upstream answers 500): the error
    // notice under the main button.
    name: 'listen-error',
    async setup(page, fake) {
      await installSyntheticAudio(page)
      await openApp(page)
      await fillSource(page, visualText('speech-error'))
      await waitForDone(page)
      await listenButton(page).click()
      await expect(
        page.getByTestId('output-toolbar').getByRole('status'),
      ).toHaveText("Couldn't play audio. Try again.")
      await expect(listenButton(page)).toHaveAttribute('aria-pressed', 'false')
      expect((await fake.stats()).speechRequests).toBe(1)
    },
  },
  {
    // Desktop workspace breakdown with one phrase expanded: its facts
    // inline, the phrase marked in the main text and its counterpart
    // quotation marked under the source.
    name: 'learning-reference',
    projects: /-(macbook-14|macbook-16|desktop-short)$/,
    async setup(page) {
      await openApp(page)
      // No marker: the default fixture, with learning phrases.
      await fillSource(page, 'How are you doing today, my friend?')
      await waitForDone(page)
      const row = page.getByTestId('learning-chunk').nth(1)
      await row.click()
      await expect(row).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByTestId('selected-phrase')).toHaveText(
        '어떻게 지내요',
      )
      await expect(
        page.getByTestId('source-highlight').locator('mark'),
      ).toHaveText('How are you doing')
    },
  },
  {
    // Learning the original Korean source: grammar underlines in the source
    // mirror before any selection; the breakdown beside it where the layout
    // has a reference pane.
    name: 'learning-source-underlines',
    async setup(page) {
      await openApp(page)
      // Enough Hangul for auto source to route it to English.
      await fillSource(
        page,
        '[fx:learn-reading] 오늘 도와줘서 고마워요. 다시 한 번 진심으로 감사드립니다 여러분',
      )
      await waitForDone(page)
      await expect(page.getByTestId('source-grammar')).toHaveText([
        '줘서',
        '고마워요',
      ])
    },
  },
  {
    // The mobile learning surface opened from the main text, with one
    // phrase expanded: the heading names it, the reference is hidden and
    // the Copy/Listen dock stays beneath.
    name: 'learning-open',
    projects: /-(portrait|landscape)$/,
    async setup(page) {
      await openApp(page)
      // No marker: the default fixture, with learning phrases.
      await fillSource(page, 'How are you doing today, my friend?')
      await waitForDone(page)
      // On the text itself: a tap past the end of a short line is ignored.
      await page
        .getByTestId('main-translation')
        .click({ position: { x: 4, y: 8 } })
      const panel = page.getByTestId('learning-panel')
      await expect(panel).toBeVisible()
      const row = page.getByTestId('learning-chunk').nth(1)
      await row.click()
      await expect(row).toHaveAttribute('aria-expanded', 'true')
      await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
        'Learn · 어떻게 지내요',
      )
      await restMouse(page)
    },
  },
  {
    // A refined result: the Softer re-run replaced main, rationale,
    // alternatives and phrase rows (the Adjust menu itself is Task 26's).
    name: 'refine-softer',
    async setup(page) {
      await refinePlain(page)
      await page.getByTestId('refine-chip-softer').click()
      await expect(page.getByTestId('main-translation')).toHaveText(
        '오늘 어떻게 지내세요?',
      )
      await waitForDone(page)
      await expect(page.getByTestId('alternative-item')).toHaveCount(1)
      await restMouse(page)
    },
  },
  {
    // A failed refine rolled back: the previous result, rows and
    // explanation, with no error view.
    name: 'refine-rollback',
    async setup(page) {
      await refinePlain(page)
      await page.getByTestId('refine-custom-trigger').click()
      await page.getByTestId('refine-freeform').fill('[fx:refine-fail]')
      await page.getByTestId('refine-freeform').press('Enter')
      await expect(page.getByTestId('refine-error')).toBeVisible({
        timeout: 20_000,
      })
      await waitForDone(page)
      await expect(page.getByTestId('alternative-item')).toHaveCount(2)
      await restMouse(page)
    },
  },
]

/** The pointer leaves where the Adjust controls were: their placement
 * differs until Task 26, and a hover on the main text shows. */
async function restMouse(page: Page): Promise<void> {
  await page.mouse.move(0, 0)
}

/** The plain fixture's finished result with its refine chips showing. */
async function refinePlain(page: Page): Promise<void> {
  await openApp(page)
  await fillSource(page, visualText('plain'))
  await waitForDone(page)
  await expect(page.getByTestId('alternative-item')).toHaveCount(2)
  const trigger = page.getByTestId('adjust-button')
  if (await trigger.isVisible()) await trigger.click()
  await expect(page.getByTestId('refine-chip-softer')).toBeEnabled()
}

/** The visual fixture's result, then a tap on its main Listen. */
async function listenTo(page: Page): Promise<void> {
  await openApp(page)
  await fillSource(page, visualText('visual'))
  await waitForDone(page)
  await expect(page.getByTestId('alternative-item')).toHaveCount(2)
  await listenButton(page).click()
}
