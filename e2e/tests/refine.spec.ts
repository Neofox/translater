// Refinements (@refine): RefineRow.tsx's chips and custom adjustment, and
// TranslatorContext's refine rules (ports of RefineRow.test.tsx and
// TranslatorContext.test.tsx): immediate re-runs carrying the previous main,
// toggling back through the server LRU, caps, stale settings and the rollback
// of a failed refine. AdjustMenu.tsx's header placement (ports of
// AdjustMenu.test.tsx and the Adjust tests of learning.browser.tsx and
// mobile.browser.tsx): measured in-line chips, the floating panel clear of
// Copy/Listen, dismissal and the tight-keyboard Custom editor.
import type { Locator, Page } from '@playwright/test'
import { installFakeVisualViewport } from '../perf/page-scripts'
import type { PageGlobals } from '../perf/page-scripts'
import { installSyntheticAudio } from './syntheticAudio'
import {
  STRINGS,
  copyButton,
  expect,
  fillSource,
  fixture,
  mainText,
  mainTranslation,
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

const PLAIN = fixture('plain').result.main!
const SOFTER = fixture('refine-softer').result.main!

const chip = (page: Page, id: string) => page.getByTestId(`refine-chip-${id}`)
const customTrigger = (page: Page) => page.getByTestId('refine-custom-trigger')
const freeform = (page: Page) => page.getByTestId('refine-freeform')
const custom = (page: Page) => page.getByTestId('refine-custom')
const trigger = (page: Page) => page.getByTestId('adjust-button')
const openPanel = (page: Page) => page.locator('.adjust-content[data-open]')
const settings = (page: Page) => page.locator('.app-settings')

/** The desktop header gives Tone, Adjust and Settings half its width, where
 * the English chips never fit; a wider settings column has room for them. */
async function makeRoom(page: Page): Promise<void> {
  await page.locator('.app-header').evaluate((e: HTMLElement) => {
    e.style.gridTemplateColumns = 'auto minmax(0, 1fr)'
  })
}

/** Caps the settings column (AdjustMenu's browser tests narrow it to 450 px);
 * '' restores it. */
async function setSettingsWidth(page: Page, max: string): Promise<void> {
  await settings(page).evaluate((e: HTMLElement, value) => {
    e.style.maxWidth = value
  }, max)
}

/** The element a tap at `locator`'s centre reaches is that button. */
async function hits(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return (
      document
        .elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        ?.closest('button') === el
    )
  })
}

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  expect(b, 'element has a box').not.toBeNull()
  return b!
}

async function expectInViewport(page: Page, locator: Locator): Promise<void> {
  const b = await box(locator)
  const { width, height } = page.viewportSize()!
  expect(b.x).toBeGreaterThanOrEqual(-1)
  expect(b.y).toBeGreaterThanOrEqual(-1)
  expect(b.x + b.width).toBeLessThanOrEqual(width + 1)
  expect(b.y + b.height).toBeLessThanOrEqual(height + 1)
}

/** The simulated software keyboard (installFakeVisualViewport): the visual
 * viewport's height, or the real one with null; then a frame. */
async function setKeyboard(page: Page, height: number | null): Promise<void> {
  await page.evaluate(async (h) => {
    ;(window as unknown as PageGlobals).__keyboard!.set(
      h,
      h === null ? null : 0,
    )
    await new Promise(requestAnimationFrame)
  }, height)
}

/** The chips sit behind the Adjust trigger unless they fit beside Tone
 * (then the trigger hides). */
async function openAdjust(
  page: Page,
  shown = chip(page, 'softer'),
): Promise<void> {
  const button = trigger(page)
  if (
    (await button.isVisible()) &&
    (await button.getAttribute('aria-expanded')) !== 'true'
  )
    await button.click()
  await expect(shown).toBeVisible()
}

/** Collapse an open Adjust disclosure so it covers nothing. */
async function closeAdjust(page: Page): Promise<void> {
  const button = trigger(page)
  if (
    (await button.isVisible()) &&
    (await button.getAttribute('aria-expanded')) === 'true'
  )
    await button.click()
}

/** A finished, current sentence result for `[fx:plain]`. */
async function translatePlain(page: Page): Promise<void> {
  await fillSource(page, sentence('plain'))
  await waitForMain(page, PLAIN)
  await waitForDone(page)
  await openAdjust(page)
  await expect(chip(page, 'softer')).toBeEnabled()
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
  // The custom button leaves the DOM: a floating Adjust must not treat that
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
    await translatePlain(page)
    // The open panel floats over the result's language bar.
    if (setting === 'target') await closeAdjust(page)
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
  fake,
}) => {
  await translatePlain(page)
  const alternatives = await page.getByTestId('alternative-item').count()
  // Phrase rows show in the reference pane.
  const visibleRows = () =>
    page.getByTestId('learning-chunk').filter({ visible: true })
  const rows = await visibleRows().count()
  const phrases = await page.getByTestId('inspectable-phrase').count()
  // A phrase selected before the refine is not selected after the rollback
  // (the selection belongs to a result; LearningProvider resets it).
  // Only the desktop workspace expands a row inline; elsewhere (split, book)
  // selecting one opens the full learning surface, which hides the header
  // and with it Adjust.
  const first = page.getByTestId('learning-chunk').first()
  const desktop = await page.locator('.app-shell[data-desktop]').count()
  if (desktop && (await first.isVisible())) {
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

  // The notice stays until the next refine action, which refines the
  // restored result (not the failed request).
  await openAdjust(page)
  await chip(page, 'softer').click()
  await expect(notice).toBeHidden()
  await waitForMain(page, SOFTER)
  const text = userText((await fake.bodies()).at(-1)!)
  expect(text).toContain('- make it softer')
  expect(text).toContain(`previous: ${PLAIN}`)
  expect(text).not.toContain('[fx:refine-fail]')
})

test('a failed refine restores idle Listen and Copy on its rows @refine', async ({
  page,
}) => {
  await installSyntheticAudio(page)
  await openApp(page)
  await translatePlain(page)
  await closeAdjust(page)
  const row = page.getByTestId('alternative-item').first()
  const listen = row.getByTestId('listen-button')
  const copy = row.getByTestId('copy-button')
  await listen.click()
  await expect(listen).toHaveAttribute('aria-pressed', 'true')
  await copy.click()
  await expect(copy).toHaveAttribute('aria-label', STRINGS.en.copied)
  await openAdjust(page)
  await customTrigger(page).click()
  await freeform(page).fill('[fx:refine-fail]')
  await freeform(page).press('Enter')
  await expect(page.getByTestId('refine-error')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByTestId('alternative-item').first()).toBeVisible()
  await expect(listen).toHaveAttribute('aria-pressed', 'false')
  await expect(listen).toHaveAttribute('aria-label', STRINGS.en.listen)
  await expect(copy).toHaveAttribute('aria-label', STRINGS.en.copy)
  await expect(copy).toHaveAttribute('title', STRINGS.en.copy)
})

test('a non-refine error does not roll back @refine', async ({ page }) => {
  await translatePlain(page)
  await chip(page, 'softer').click()
  await waitForMain(page, SOFTER)
  await waitForDone(page)
  // Toggled back off (the server LRU answers): the snapshot stack is not
  // empty, and the next request carries no adjustment.
  await openAdjust(page)
  await chip(page, 'softer').click()
  await waitForMain(page, PLAIN)
  await waitForDone(page)
  // A context run (not a refinement) whose request only refine-fail matches
  // with both of its entries.
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

// ----- Adjust menu (AdjustMenu.tsx) -----------------------------------------

test('shows active adjustments while collapsed and retains a custom draft through collapse @refine', async ({
  page,
}) => {
  await translatePlain(page)
  await chip(page, 'softer').click()
  await waitForMain(page, SOFTER)
  await waitForDone(page)
  const button = trigger(page)
  // A chip acts inside the panel, which stays open.
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await button.click()
  const label = `${STRINGS.en.adjust} · ${STRINGS.en.refineSofter}`
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(button).toHaveAttribute('aria-label', label)
  await expect(button).toHaveAttribute('data-active', 'true')
  await expect(button).toHaveClass(/bg-accent-soft/)
  if (/adjust-trigger-compact/.test((await button.getAttribute('class')) ?? ''))
    await expect(button).toHaveAttribute('title', label)
  else {
    await expect(button).not.toHaveAttribute('title', /.*/)
    await expect(button).toContainText(label)
  }
  await button.click()
  await customTrigger(page).click()
  await freeform(page).fill('gentler please')
  await button.click()
  await expect(freeform(page)).toBeHidden()
  await button.click()
  await expect(freeform(page)).toHaveValue('gentler please')
})

test('Escape inside the open Adjust panel closes it and keeps the source @refine', async ({
  page,
}) => {
  await translatePlain(page)
  const text = await source(page).inputValue()
  await customTrigger(page).click()
  await expect(freeform(page)).toBeFocused()
  await freeform(page).press('Escape')
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger(page)).toBeFocused()
  await expect(openPanel(page)).toHaveCount(0)
  await trigger(page).click()
  await expect(openPanel(page)).toHaveCount(1)
  await trigger(page).press('Escape')
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(source(page)).toHaveValue(text)
  expect(await mainText(page)).toBe(PLAIN)
})

test('closes with Escape even when a touch activation leaves focus outside the menu @refine', async ({
  page,
}) => {
  await translatePlain(page)
  await expect(openPanel(page)).toHaveCount(1)
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  )
  await page.keyboard.press('Escape')
  await expect(openPanel(page)).toHaveCount(0)
  // That Escape then reaches the translator shortcut, which clears
  // the source; the menu leaves with the sentence result.
  await expect(source(page)).toHaveValue('')
  await expect(trigger(page)).toHaveCount(0)
})

test('adjustments stay with tone in the header and expose chips when there is room @refine', async ({
  page,
}) => {
  const viewport = page.viewportSize()!
  await fillSource(page, sentence('plain'))
  await waitForMain(page, PLAIN)
  await waitForDone(page)
  const button = trigger(page)
  const softer = chip(page, 'softer')
  const menu = page.locator('.adjust-menu')
  if (viewport.width >= 1100) {
    // Room appears while the trigger has focus: the first chip takes it.
    await button.focus()
    await makeRoom(page)
    await expect(menu).toHaveAttribute('data-inline', 'true')
    await expect(softer).toBeFocused()
  }
  const inline = (await menu.getAttribute('data-inline')) === 'true'
  const tone = await box(page.getByTestId('settings-button'))
  if (inline) {
    await expect(softer).toBeVisible()
    await expect(button).toBeHidden()
    expect(Math.abs((await box(softer)).y - tone.y)).toBeLessThanOrEqual(2)
  } else {
    await expect(button).toBeVisible()
    await expect(
      page.locator('.app-header').getByTestId('adjust-button'),
    ).toHaveCount(1)
    expect(Math.abs((await box(button)).y - tone.y)).toBeLessThanOrEqual(2)
    await button.click()
    await expect(softer).toBeVisible()
  }
  await customTrigger(page).click()
  await freeform(page).fill('gentler please')
  await expect(
    page.getByTestId('output-toolbar').getByTestId('refine-freeform'),
  ).toHaveCount(0)
  const node = await freeform(page).elementHandle({ timeout: 5_000 })
  if (inline) {
    // No longer fitting with focus in the field opens the panel around the
    // same input.
    await setSettingsWidth(page, '450px')
    await expect(button).toBeVisible()
    await expect(freeform(page)).toBeVisible()
    expect(
      await node.evaluate(
        (n) => n === document.querySelector('[data-testid="refine-freeform"]'),
      ),
    ).toBe(true)
    await setSettingsWidth(page, '')
    await expect(button).toBeHidden()
  }
  await expect(freeform(page)).toHaveValue('gentler please')
  if (!inline) {
    const panel = openPanel(page)
    await expect(panel).toHaveAttribute('data-overlay', 'true')
    expect(await panel.evaluate((p) => p.scrollWidth <= p.clientWidth)).toBe(
      true,
    )
    const editor = await box(source(page))
    const actions = await box(page.locator('.composer-actions'))
    if (actions.y + actions.height > editor.y)
      expect(editor.y + 24).toBeLessThanOrEqual(actions.y)
    if (viewport.height < 460 && viewport.width >= 560)
      expect(editor.y + editor.height).toBeLessThanOrEqual(actions.y)
  }
  await expectInViewport(page, copyButton(page))
  await expectInViewport(page, page.getByTestId('clear-input'))
  if (!inline) {
    // Dismissal runs after the click's own action: Copy still copies.
    await copyButton(page).click()
    expect(await readClipboard(page)).toBe(PLAIN)
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  }
})

test('desktop Adjust overlays without growing the header or covering primary actions @refine', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width < 1100, 'desktop workspace only')
  await fillSource(page, sentence('plain'))
  await waitForMain(page, PLAIN)
  await waitForDone(page)
  const header = page.locator('.app-header')
  for (const width of [1280, 1512, 2048]) {
    await page.setViewportSize({ width, height: 982 })
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-layout',
      'workspace',
    )
    await expect(trigger(page)).toBeVisible()
    const before = await box(header)
    const actions = [copyButton(page), page.getByTestId('paste-input')]
    const boxes = await Promise.all(actions.map(box))
    await trigger(page).click()
    await expect(chip(page, 'softer')).toBeVisible()
    await expect
      .poll(async () => Math.abs((await box(header)).height - before.height))
      .toBeLessThanOrEqual(0.5)
    const panel = await box(openPanel(page))
    expect(panel.y).toBeGreaterThanOrEqual(before.y + before.height - 2)
    for (const [i, action] of actions.entries()) {
      expect(Math.abs((await box(action)).y - boxes[i]!.y)).toBeLessThanOrEqual(
        1,
      )
      expect(await hits(action)).toBe(true)
    }
    const primary = await box(page.locator('.primary-result-actions'))
    const overlaps =
      panel.x < primary.x + primary.width &&
      primary.x < panel.x + panel.width &&
      panel.y < primary.y + primary.height &&
      primary.y < panel.y + panel.height
    expect(
      overlaps,
      `panel ${JSON.stringify(panel)} vs ${JSON.stringify(primary)}`,
    ).toBe(false)
    await trigger(page).click()
    await expect(openPanel(page)).toHaveCount(0)
  }
})

test('mobile Adjust floats without resizing the header or moving Copy in portrait and split views @refine', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width >= 1100, 'compact layouts only')
  await fillSource(page, sentence('plain'))
  await waitForMain(page, PLAIN)
  await waitForDone(page)
  const header = page.locator('.app-header')
  for (const [width, height] of [
    [382, 580],
    [580, 382],
    [736, 594],
    [960, 548],
  ] as const) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-layout',
      width >= 560 ? 'split' : 'stack',
    )
    await expect(trigger(page)).toBeVisible()
    const before = await box(header)
    const target = await box(page.locator('.target-toolbar'))
    const copy = copyButton(page)
    const copyBefore = await box(copy)
    await trigger(page).click()
    await expect(chip(page, 'softer')).toBeVisible()
    await expect
      .poll(async () => Math.abs((await box(header)).height - before.height))
      .toBeLessThanOrEqual(1)
    expect(
      Math.abs((await box(page.locator('.target-toolbar'))).y - target.y),
    ).toBeLessThanOrEqual(1)
    expect(Math.abs((await box(copy)).y - copyBefore.y)).toBeLessThanOrEqual(1)
    expect(await hits(copy)).toBe(true)
    const panel = await box(openPanel(page))
    expect(panel.x).toBeGreaterThanOrEqual(0)
    expect(panel.x + panel.width).toBeLessThanOrEqual(width)
    expect(panel.y + panel.height).toBeLessThanOrEqual(height)
    await trigger(page).press('Escape')
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
  }
})

test('opening Custom with phrase details already open keeps Copy clickable @refine', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width >= 560, 'phone layouts only')
  // The default fixture carries learning phrases.
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  await mainTranslation(page).getByTestId('inspectable-phrase').first().click()
  await expect(page.getByTestId('learning-inspector')).toBeVisible()
  await page
    .getByRole('button', { name: 'Close learning', exact: true })
    .click()
  await trigger(page).click()
  await customTrigger(page).click()
  await freeform(page).fill('gentler please')
  await expect.poll(() => hits(copyButton(page))).toBe(true)
  await trigger(page).click()
  // On the text itself: a tap past the end of a short main line does not
  // inspect (learning.spec.ts openOverview).
  await mainTranslation(page).click({ position: { x: 4, y: 8 } })
  await expect(freeform(page)).toBeHidden()
  await expect(page.getByTestId('learning-inspector')).toBeVisible()
})

test('header custom adjustments keep keyboard focus and restore the source keyboard layout @refine', async ({
  page,
}) => {
  const viewport = page.viewportSize()!
  test.skip(
    viewport.width >= 500 || viewport.height < 450,
    'phone portrait only',
  )
  await page.addInitScript(installFakeVisualViewport)
  await page.reload({ waitUntil: 'networkidle' })
  await translatePlain(page)
  await customTrigger(page).click()
  const field = freeform(page)
  await field.fill('gentler please')
  const tight = Math.min(319, Math.floor(viewport.height * 0.55))
  for (const height of [
    Math.floor(viewport.height * 0.85),
    Math.floor(viewport.height * 0.7),
    tight,
  ])
    await setKeyboard(page, height)
  const shell = page.locator('.app-shell')
  await expect(shell).toHaveAttribute('data-keyboard', 'true')
  await expect(shell).toHaveAttribute('data-tight', 'true')
  await expect(field).toBeVisible()
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('gentler please')
  // The dedicated editor reserves its height in the header.
  expect(
    await page
      .locator('.app-header')
      .evaluate((h) =>
        parseFloat(h.style.getPropertyValue('--adjust-panel-height')),
      ),
  ).toBeGreaterThan(0)
  const headerBox = await box(page.locator('.app-header'))
  expect(headerBox.y + headerBox.height).toBeLessThan(tight)
  const fieldBox = await box(field)
  const composer = await box(page.locator('.input-panel'))
  expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(composer.y)
  const copy = await box(copyButton(page))
  expect(copy.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height)
  expect(copy.y + copy.height).toBeLessThanOrEqual(composer.y)
  const main = await box(mainTranslation(page))
  expect(main.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height)
  expect(main.y + 24).toBeLessThanOrEqual(copy.y)
  for (const id of ['refine-apply', 'refine-close']) {
    const b = await box(page.getByTestId(id))
    expect(b.height).toBeGreaterThanOrEqual(44)
    expect(b.x + b.width).toBeLessThanOrEqual(viewport.width)
    expect(b.y + b.height).toBeLessThanOrEqual(fieldBox.y + fieldBox.height + 2)
  }
  // Close keeps the draft and returns to the source.
  await page.getByTestId('refine-close').click()
  await expect(field).toBeHidden()
  await expect(source(page)).toBeFocused()
  await setKeyboard(page, null)
  await trigger(page).click()
  await customTrigger(page).click()
  await expect(field).toHaveValue('gentler please')
  await expect(field).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
  await source(page).focus()
  await setKeyboard(page, tight)
  await expect
    .poll(() =>
      page.locator('.app-header').evaluate((h) => getComputedStyle(h).display),
    )
    .toBe('none')
  const copyAfter = await box(copyButton(page))
  expect(copyAfter.y + copyAfter.height).toBeLessThanOrEqual(tight)
  await expectInViewport(page, copyButton(page))
  await expectInViewport(page, page.getByTestId('clear-input'))
})

test('adjustment width measurement reconnects after an error and same-sentence retry @refine', async ({
  page,
}) => {
  await translatePlain(page)
  if (page.viewportSize()!.width >= 1100) {
    await makeRoom(page)
    await expect(page.locator('.adjust-menu')).toHaveAttribute(
      'data-inline',
      'true',
    )
  }
  // A context run (no adjustment) that fails, then the same sentence again.
  await setContext(page, '[fx:refine-fail]')
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 })
  await expect(chip(page, 'softer')).toBeHidden()
  await page.getByTestId('context-clear').click()
  await waitForMain(page, PLAIN)
  await waitForDone(page)
  await expect(chip(page, 'softer')).toBeAttached()
  await setSettingsWidth(page, '450px')
  await expect(trigger(page)).toBeVisible()
  await expect(page.locator('.adjust-menu')).not.toHaveAttribute(
    'data-inline',
    /.*/,
  )
  await openAdjust(page)
  await expect(chip(page, 'softer')).toBeVisible()
})

test('header settings keep their position when sentence adjustments first appear @refine', async ({
  page,
}) => {
  const controls = page
    .locator('.mode-segment, .mode-select, .settings-trigger')
    .filter({ visible: true })
  const boxes = () =>
    controls.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect),
    )
  const before = await boxes()
  expect(before.length).toBeGreaterThan(0)
  await fillSource(page, sentence('plain'))
  await waitForMain(page, PLAIN)
  await expect(page.locator('.adjust-menu')).toHaveCount(1)
  const after = await boxes()
  expect(after.length).toBe(before.length)
  after.forEach((rect, i) => {
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(
        Math.abs(rect[key] - before[i]![key]),
        `header ${i} ${key}`,
      ).toBeLessThanOrEqual(1)
  })
})
