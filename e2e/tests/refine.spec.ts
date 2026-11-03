// Refinements (@refine): RefineRow.tsx's chips and custom adjustment, and
// TranslatorContext's refine rules (ports of RefineRow.test.tsx and
// TranslatorContext.test.tsx): immediate re-runs carrying the previous main,
// toggling back through the server LRU, caps, stale settings and the rollback
// of a failed refine.
import type { Page } from '@playwright/test'
import {
  STRINGS,
  copyButton,
  expect,
  fillSource,
  fixture,
  mainText,
  nonce,
  openApp,
  pickLanguage,
  readClipboard,
  sentence,
  setTone,
  source,
  test,
  userText,
  waitForDone,
  waitForMain,
  waitForStats,
} from './helpers'
import { APP, TS_BUILD } from '../ports'

const PLAIN = fixture('plain').result.main!
const SOFTER = fixture('refine-softer').result.main!

const chip = (page: Page, id: string) => page.getByTestId(`refine-chip-${id}`)
const customTrigger = (page: Page) => page.getByTestId('refine-custom-trigger')
const freeform = (page: Page) => page.getByTestId('refine-freeform')
const custom = (page: Page) => page.getByTestId('refine-custom')

/** Compact headers keep the chips behind Adjust (AGENTS.md); wide ones show
 * them inline, with the trigger hidden. */
async function openAdjust(
  page: Page,
  shown = chip(page, 'softer'),
): Promise<void> {
  const trigger = page.getByTestId('adjust-button')
  if (
    (await trigger.isVisible()) &&
    (await trigger.getAttribute('aria-expanded')) !== 'true'
  )
    await trigger.click()
  await expect(shown).toBeVisible()
}

/** Collapse an open Adjust disclosure so it covers nothing. */
async function closeAdjust(page: Page): Promise<void> {
  const trigger = page.getByTestId('adjust-button')
  if (
    (await trigger.isVisible()) &&
    (await trigger.getAttribute('aria-expanded')) === 'true'
  )
    await trigger.click()
}

/** A finished, current sentence result for `[fx:plain]`. */
async function translatePlain(page: Page): Promise<void> {
  await fillSource(page, sentence('plain'))
  await waitForMain(page, PLAIN)
  await waitForDone(page)
  await openAdjust(page)
  await expect(chip(page, 'softer')).toBeEnabled()
}

/** The TS dev server loses the reply context (context.spec.ts). */
function skipTsDev(): void {
  test.skip(
    APP === 'ts' && TS_BUILD === 'dev',
    'TS dev server loses nt.context; use E2E_TS_BUILD=prod',
  )
}

async function setContext(page: Page, text: string): Promise<void> {
  await page.getByTestId('context-toggle').click()
  await page.getByTestId('context-textarea').fill(text)
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('chips toggle and re-run immediately @refine', async ({ page, fake }) => {
  await translatePlain(page)
  const before = await fake.requests()
  const softer = chip(page, 'softer')
  await expect(softer).toHaveAttribute('aria-pressed', 'false')
  const clicked = Date.now()
  await softer.click()
  await expect(softer).toHaveAttribute('aria-pressed', 'true')
  await waitForStats(fake, (s) => s.requests === before + 1)
  expect(Date.now() - clicked, 'no debounce for a refinement').toBeLessThan(300)
  const text = userText((await fake.bodies()).at(-1)!)
  expect(text).toContain('<adjustments>')
  expect(text).toContain('make it softer')
  expect(text).toContain(`previous: ${PLAIN}`)
  await waitForMain(page, SOFTER)
  await waitForDone(page)

  // Toggling off asks for the original request again: the server LRU
  // answers it, and the original main comes back.
  await openAdjust(page)
  await softer.click()
  await expect(softer).toHaveAttribute('aria-pressed', 'false')
  await waitForMain(page, PLAIN)
  await waitForDone(page)
  expect(await fake.requests()).toBe(before + 1)
})

test('free-text Enter replaces the input with a truncated custom button and clicking it restores the input @refine', async ({
  page,
}) => {
  await translatePlain(page)
  await customTrigger(page).click()
  await expect(customTrigger(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(freeform(page)).toBeFocused()
  await expect(freeform(page)).toHaveAttribute('maxlength', '200')
  await freeform(page).fill('make it a bit less formal')
  await freeform(page).press('Enter')

  await expect(custom(page)).toHaveText('make it a bit less f…')
  await expect(custom(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(custom(page)).toHaveAttribute(
    'title',
    'make it a bit less formal',
  )
  await expect(custom(page)).toHaveAttribute(
    'aria-label',
    `${STRINGS.en.refineRemove}: make it a bit less formal`,
  )
  await expect(freeform(page)).toBeHidden()
  await expect(customTrigger(page)).toBeHidden()
  await waitForDone(page)

  await openAdjust(page)
  await custom(page).click()
  await expect(custom(page)).toBeHidden()
  // The custom button leaves the DOM: in TS a floating Adjust treats that
  // click as outside and collapses, and the wider editor stops fitting inline.
  await openAdjust(page, freeform(page))
  await expect(freeform(page)).toBeVisible()
  await expect(freeform(page)).toHaveValue('')
})

test('caps at 3 adjustments @refine', async ({ page }) => {
  await translatePlain(page)
  for (const id of ['softer', 'direct', 'shorter']) {
    await openAdjust(page)
    await chip(page, id).click()
    await expect(chip(page, id)).toHaveAttribute('aria-pressed', 'true')
    await waitForDone(page)
  }
  await openAdjust(page)
  await expect(chip(page, 'playful')).toBeDisabled()
  await expect(customTrigger(page)).toBeDisabled()
  await expect(freeform(page)).toBeDisabled()
  // Active chips stay enabled so any of them can be toggled back off.
  for (const id of ['softer', 'direct', 'shorter'])
    await expect(chip(page, id)).toBeEnabled()
})

test('offers Apply and Close, preserving an unapplied draft @refine', async ({
  page,
  fake,
}) => {
  await translatePlain(page)
  const before = await fake.requests()
  await customTrigger(page).click()
  await freeform(page).fill('gentler please')
  await page.getByRole('button', { name: STRINGS.en.refineClose }).click()
  await expect(freeform(page)).toBeHidden()
  await expect(source(page)).toBeFocused()
  await expect(custom(page)).toBeHidden()

  await openAdjust(page)
  await customTrigger(page).click()
  await expect(freeform(page)).toHaveValue('gentler please')
  await page
    .getByRole('button', { name: STRINGS.en.refineApply, exact: true })
    .click()
  await expect(custom(page)).toHaveText('gentler please')
  await waitForStats(fake, (s) => s.requests === before + 1)
  expect(userText((await fake.bodies()).at(-1)!)).toContain('- gentler please')
})

test('keeps static refinement controls disabled while a sentence is incomplete @refine', async ({
  page,
}) => {
  await fillSource(page, sentence('slow'))
  await expect(
    page.getByTestId('adjust-button').or(chip(page, 'softer')).first(),
  ).toBeAttached({
    timeout: 20_000,
  })
  await openAdjust(page)
  await expect(chip(page, 'softer')).toBeDisabled()
  await expect(customTrigger(page)).toBeDisabled()
  await waitForDone(page, 30_000)
  await expect(chip(page, 'softer')).toBeEnabled()
  await expect(chip(page, 'softer')).toHaveAttribute('aria-pressed', 'false')
})

for (const setting of ['tone', 'target', 'context'] as const) {
  test(`${setting} change disables chips until the new result @refine`, async ({
    page,
  }) => {
    if (setting === 'context') skipTsDev()
    await translatePlain(page)
    await closeAdjust(page)
    if (setting === 'tone') await setTone(page, 'professional')
    else if (setting === 'target') await pickLanguage(page, 'target', 'ja')
    else await setContext(page, 'Replying to a colleague.')
    await openAdjust(page)
    await expect(chip(page, 'softer')).toBeDisabled()
    await waitForDone(page)
    await openAdjust(page)
    await expect(chip(page, 'softer')).toBeEnabled()
  })
}

test('renders nothing without a completed sentence result @refine', async ({
  page,
}) => {
  await expect(page.getByTestId('adjust-button')).toHaveCount(0)
  await fillSource(page, `hello ${fixture('word').match}${nonce().slice(0, 5)}`)
  await waitForDone(page)
  await expect(page.getByTestId('adjust-button')).toHaveCount(0)
  await expect(chip(page, 'softer')).toBeHidden()
})

test('failed refine rolls back to the previous result with a compact notice @refine', async ({
  page,
}) => {
  await translatePlain(page)
  const alternatives = await page.getByTestId('alternative-item').count()
  // Phrase rows show in the reference pane (TS mounts them only there).
  const visibleRows = () =>
    page.getByTestId('learning-chunk').filter({ visible: true })
  const rows = await visibleRows().count()
  const phrases = await page.getByTestId('inspectable-phrase').count()
  // A phrase selected before the refine is not selected after the rollback
  // (the selection belongs to a result; LearningProvider resets it).
  const first = page.getByTestId('learning-chunk').first()
  if (await first.isVisible()) {
    await first.click()
    await expect(first).toHaveAttribute('aria-expanded', 'true')
  }
  await openAdjust(page)
  await customTrigger(page).click()
  await freeform(page).fill('[fx:refine-fail]')
  await freeform(page).press('Enter')

  const notice = page.getByTestId('refine-error')
  await expect(notice).toBeVisible({ timeout: 20_000 })
  await expect(notice).toHaveText(
    `${STRINGS.en.refineFailed}: ${STRINGS.en.translationFailed}`,
  )
  await expect(page.getByRole('alert')).toBeHidden()
  expect(await mainText(page)).toBe(PLAIN)
  await expect(page.getByTestId('alternative-item')).toHaveCount(alternatives)
  await expect(visibleRows()).toHaveCount(rows)
  await expect(
    page.locator('[data-testid="learning-chunk"][aria-expanded="true"]'),
  ).toHaveCount(0)
  await expect(page.getByTestId('inspectable-phrase')).toHaveCount(phrases)
  await expect(custom(page)).toBeHidden()
  // RefineRow stays mounted: the editor it was submitted from stays open.
  await expect(freeform(page)).toBeVisible()
  await expect(freeform(page)).toHaveValue('')
  await expect(chip(page, 'softer')).toBeEnabled()
  await expect(copyButton(page)).toBeEnabled()
  // Closing the editor collapses a disclosure, which then shows the notice.
  await page.getByTestId('refine-close').click()
  if (await page.getByTestId('adjust-button').isVisible())
    await expect(page.locator('.adjust-error')).toHaveText(
      `${STRINGS.en.refineFailed}: ${STRINGS.en.translationFailed}`,
    )
  await copyButton(page).click()
  expect(await readClipboard(page)).toBe(PLAIN)

  // The notice stays until the next refine action.
  await openAdjust(page)
  await chip(page, 'softer').click()
  await expect(notice).toBeHidden()
  await waitForMain(page, SOFTER)
})

test('a non-refine error does not roll back @refine', async ({ page }) => {
  skipTsDev()
  await translatePlain(page)
  await chip(page, 'softer').click()
  await waitForMain(page, SOFTER)
  await waitForDone(page)
  await closeAdjust(page)
  // A context run (not a refinement) whose request selects refine-fail: the
  // tie with refine-softer goes to the earlier file.
  await setContext(page, '[fx:refine-fail]')
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 20_000 })
  await expect(alert).toContainText(STRINGS.en.translationFailed)
  await expect(page.getByTestId('refine-error')).toBeHidden()
  await expect(page.getByTestId('main-translation')).toBeHidden()
})

test('editing the input clears refinements @refine', async ({ page, fake }) => {
  await translatePlain(page)
  await chip(page, 'softer').click()
  await waitForMain(page, SOFTER)
  await waitForDone(page)
  const before = await fake.requests()
  await source(page).press('End')
  await source(page).pressSequentially(' ok')
  await openAdjust(page)
  await expect(chip(page, 'softer')).toHaveAttribute('aria-pressed', 'false')
  await waitForStats(fake, (s) => s.requests === before + 1)
  expect(userText((await fake.bodies()).at(-1)!)).not.toContain('<adjustments>')
})
