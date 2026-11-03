// Reply context (@context): ContextField.tsx's toggle and field, kept in
// sessionStorage for the tab and sent with every run. Also the header's
// Settings popover and the More… language menus (SettingsMenu.tsx,
// Select.tsx and their floatingPanelBoundary placement).
import type { Locator, Page } from '@playwright/test'
import {
  expect,
  fillSource,
  openApp,
  sentence,
  source,
  test,
  userText,
  waitForDone,
  waitForStats,
} from './helpers'
import { APP, TS_BUILD } from '../ports'

const toggle = (page: Page) => page.getByTestId('context-toggle')
const field = (page: Page) => page.getByTestId('context-textarea')

/** Found here: under `vite dev` the TS app loses the reply context. A
 * typed context resets to empty (useStoredState's late storage read wins
 * over the edit) and is not reopened after a reload. Its production build
 * behaves, so the TS side of these tests needs E2E_TS_BUILD=prod. */
function skipTsDev(): void {
  test.skip(
    APP === 'ts' && TS_BUILD === 'dev',
    'TS dev server loses nt.context; use E2E_TS_BUILD=prod',
  )
}

async function openContext(page: Page): Promise<void> {
  await toggle(page).click()
  await expect(field(page)).toBeVisible()
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('toggle opens the context textarea and typing persists to sessionStorage @context', async ({
  page,
}) => {
  await expect(field(page)).toBeHidden()
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
  await openContext(page)
  await expect(field(page)).toHaveAttribute('maxlength', '1000')
  await field(page).fill('hi')
  expect(
    await page.evaluate(() => sessionStorage.getItem('nt.context')),
  ).toBe('"hi"')
  await expect(page.getByTestId('context-clear')).toBeVisible()
  // The toggle closes the field again and keeps the text.
  await toggle(page).click()
  await expect(field(page)).toBeHidden()
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
  await toggle(page).click()
  await expect(field(page)).toHaveValue('hi')
})

test('clear empties the context and keeps the field open @context', async ({
  page,
}) => {
  await openContext(page)
  await field(page).fill('A friendly greeting.')
  await page.getByTestId('context-clear').click()
  await expect(field(page)).toHaveValue('')
  await expect(field(page)).toBeVisible()
  await expect(page.getByTestId('context-clear')).toBeHidden()
  expect(
    await page.evaluate(() => sessionStorage.getItem('nt.context')),
  ).toBe('""')
})

test('context is sent with the run and edits re-run @context', async ({
  page,
  fake,
}) => {
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  expect(await fake.requests()).toBe(1)
  expect(userText((await fake.bodies()).at(-1)!)).not.toContain('<context>')

  await openContext(page)
  await field(page).fill('Are you free for lunch tomorrow?')
  await waitForStats(fake, (s) => s.requests === 2)
  await waitForDone(page)
  let body = userText((await fake.bodies()).at(-1)!)
  expect(body).toContain('<context>')
  expect(body).toContain('Are you free for lunch tomorrow?')

  await field(page).fill('Are you free for dinner tonight?')
  await waitForStats(fake, (s) => s.requests === 3)
  await waitForDone(page)
  body = userText((await fake.bodies()).at(-1)!)
  expect(body).toContain('Are you free for dinner tonight?')
})

test('context is restored after a reload in the same tab @context', async ({
  page,
}) => {
  skipTsDev()
  await openContext(page)
  await field(page).fill('See you at the station.')
  await page.reload({ waitUntil: 'networkidle' })
  await expect(field(page)).toBeVisible()
  await expect(field(page)).toHaveValue('See you at the station.')
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
  // A non-blank context tints the toggle (Pill tone active).
  await expect(toggle(page)).toHaveClass(/bg-accent-soft/)
})

test('Clear input preserves the context and focuses the source @context', async ({
  page,
}) => {
  skipTsDev()
  // Source first: short split panes give the open context field the room.
  await fillSource(page, sentence('default'))
  await openContext(page)
  await field(page).fill('Thanks for yesterday.')
  // The context state has settled (a Clear racing the edit lost it once on
  // TS prod).
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('nt.context')))
    .toBe('"Thanks for yesterday."')
  await page.getByTestId('clear-input').click()
  await expect(source(page)).toHaveValue('')
  await expect(source(page)).toBeFocused()
  await expect(field(page)).toBeVisible()
  await expect(field(page)).toHaveValue('Thanks for yesterday.')
})

// ----- Settings popover and language menus ---------------------------------

type Box = { left: number; top: number; right: number; bottom: number }

async function box(locator: Locator): Promise<Box> {
  return locator.evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  })
}

/** `inner` lies inside `outer` shrunk by `pad` (half a pixel of rounding). */
function expectInside(inner: Box, outer: Box, pad: number, what: string) {
  expect(inner.left, `${what} left`).toBeGreaterThanOrEqual(outer.left + pad - 0.5)
  expect(inner.top, `${what} top`).toBeGreaterThanOrEqual(outer.top + pad - 0.5)
  expect(inner.right, `${what} right`).toBeLessThanOrEqual(outer.right - pad + 0.5)
  expect(inner.bottom, `${what} bottom`).toBeLessThanOrEqual(outer.bottom - pad + 0.5)
}

const viewportBox = (page: Page): Promise<Box> =>
  page.evaluate(() => ({
    left: 0,
    top: 0,
    right: document.documentElement.clientWidth,
    bottom: window.innerHeight,
  }))

test('makes UI language available in settings and persists an explicit choice @context', async ({
  page,
  context,
  browserName,
}) => {
  // WebKit (the macOS default) does not Tab to buttons.
  const tabsToButtons = browserName !== 'webkit'
  const trigger = page.getByTestId('settings-button')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const group = page.getByRole('group', { name: 'UI language' })
  const button = (name: string) => group.getByRole('button', { name, exact: true })
  await expect(group).toBeHidden()
  await expect(trigger).not.toHaveAttribute('aria-controls')

  await trigger.click()
  await expect(group).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  // While open, the trigger controls the dialog (useRole).
  const controls = await trigger.getAttribute('aria-controls')
  expect(controls).toBeTruthy()
  await expect(page.locator(`[id="${controls}"]`)).toHaveAttribute('role', 'dialog')
  // Non-modal: focus moves to the dialog, Tab reaches the toggle, and
  // Escape returns focus to the trigger.
  await expect(dialog).toBeFocused()
  if (tabsToButtons) {
    await page.keyboard.press('Tab')
    await expect(button('EN')).toBeFocused()
  }
  await page.keyboard.press('Escape')
  await expect(group).toBeHidden()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).not.toHaveAttribute('aria-controls')
  await expect(trigger).toBeFocused()
  // An outside press closes it as well.
  await trigger.click()
  await expect(group).toBeVisible()
  await page.locator('.app-brand').click()
  await expect(group).toBeHidden()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  // Tab past the last control leaves the popup: it closes and focus stays
  // on the next control after the trigger (closeOnFocusOut).
  const focusedOutside = () =>
    page.evaluate(() => {
      const a = document.activeElement
      return Boolean(
        a &&
          a !== document.body &&
          !a.closest('.settings-popover, .settings-trigger'),
      )
    })
  if (tabsToButtons) {
    await trigger.click()
    await expect(dialog).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(button('EN')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(button('한')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(group).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(await focusedOutside()).toBe(true)
  }
  // Shift+Tab from the dialog reaches the trigger and keeps it open; once
  // more leaves both, closing without returning focus.
  if (tabsToButtons) {
    await trigger.click()
    await expect(dialog).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(trigger).toBeFocused()
    await expect(group).toBeVisible()
    await page.keyboard.press('Shift+Tab')
    await expect(group).toBeHidden()
    expect(await focusedOutside()).toBe(true)
  }

  await trigger.click()
  await button('한').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
  await expect(button('한')).toHaveAttribute('aria-pressed', 'true')
  await expect(button('EN')).toHaveAttribute('aria-pressed', 'false')
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
  const cookie = (await context.cookies()).find((c) => c.name === 'nt.preferences')
  expect(JSON.parse(decodeURIComponent(cookie!.value)).uiLang).toBe('ko')
  await trigger.click()
  await expect(button('한')).toHaveAttribute('aria-pressed', 'true')
})

/** Open Settings and both More… listboxes and check where they land.
 * Settings sits in the header, outside every pane, so it stays inside the
 * viewport and its trigger's screen segment; each listbox stays inside its
 * own pane (floatingPanelBoundary: padding 8, no safe areas here). */
async function checkPopups(page: Page): Promise<void> {
  const viewport = await viewportBox(page)
  const segments: Box[] = await page.evaluate(() =>
    (
      (window as unknown as { viewport?: { segments?: DOMRect[] } }).viewport
        ?.segments ?? []
    ).map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
  )
  const trigger = page.getByTestId('settings-button')
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const popup = await box(dialog)
  const anchor = await box(trigger)
  expectInside(popup, viewport, 8, 'settings')
  // bottom-end, offset 8.
  expect(Math.abs(popup.right - anchor.right)).toBeLessThanOrEqual(1)
  expect(Math.abs(popup.top - anchor.bottom - 8)).toBeLessThanOrEqual(1)
  const x = (anchor.left + anchor.right) / 2
  const segment = segments.find((s) => s.left <= x && x <= s.right)
  if (segments.length > 1 && segment)
    expectInside(popup, segment, 0, 'settings segment')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  for (const name of ['Source language', 'Target language']) {
    const more = page
      .getByRole('group', { name, exact: true })
      .getByTestId('lang-more-trigger')
    await more.click()
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
    const pane = await box(more.locator('xpath=ancestor::section[1]'))
    expectInside(await box(listbox), pane, 8, `${name} menu`)
    await page.keyboard.press('Escape')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
  }
}

/** A listbox wider than the room right of its trigger must stay inside the
 * pane's padding box (Floating UI's clipping rect for the boundary) minus
 * 8 px: flip tries the end alignment, shift clamps. Clipped by the
 * viewport alone it would overhang the pane. The
 * source pane is the left one in split and book layouts. */
async function checkPaneClamp(page: Page): Promise<void> {
  const more = page
    .getByRole('group', { name: 'Source language', exact: true })
    .getByTestId('lang-more-trigger')
  const pane = await more.locator('xpath=ancestor::section[1]').evaluate((e) => {
    const r = e.getBoundingClientRect()
    const left = r.left + e.clientLeft
    const top = r.top + e.clientTop
    return { left, top, right: left + e.clientWidth, bottom: top + e.clientHeight }
  })
  expect(pane.right).toBeLessThan((await viewportBox(page)).right - 100)
  // Narrower than the pane, wider than the room right of the trigger.
  const width = pane.right - pane.left - 24
  expect((await box(more)).left + width).toBeGreaterThan(pane.right)
  await page.evaluate((width) => {
    const style = document.createElement('style')
    style.id = 'wide-listbox'
    style.textContent = `[role="listbox"] { width: ${width}px !important; }`
    document.head.append(style)
  }, width)
  await more.click()
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  const menu = await box(listbox)
  expectInside(menu, pane, 8, 'clamped menu')
  // Both alignments overflow the pane; bottom-end overflows less, so flip
  // keeps it and shift moves it right to the pane's left padding.
  expect(Math.abs(menu.left - pane.left - 8)).toBeLessThanOrEqual(0.5)
  await page.keyboard.press('Escape')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await page.evaluate(() => document.getElementById('wide-listbox')?.remove())
}

test('settings popover stays inside its pane in split and book layouts @context', async ({
  page,
  browserName,
}) => {
  const panels = page.locator('.translator-panels')
  // An unfolded phone held sideways: split.
  await page.setViewportSize({ width: 736, height: 594 })
  await expect(panels).toHaveAttribute('data-layout', 'split')
  await checkPopups(page)
  await checkPaneClamp(page)

  // The same screen folded like a book. Chromium emulates the posture and
  // a vertical fold over CDP; WebKit cannot.
  if (browserName !== 'chromium') return
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDevicePostureOverride', {
    posture: { type: 'folded' },
  })
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 736,
    height: 594,
    deviceScaleFactor: 1,
    mobile: false,
    displayFeature: { orientation: 'vertical', offset: 368, maskLength: 0 },
  })
  await expect(panels).toHaveAttribute('data-layout', 'book')
  await checkPopups(page)
  await checkPaneClamp(page)
})

test('language menus stay within the viewport and support keyboard selection @context', async ({
  page,
}) => {
  for (const name of ['Source language', 'Target language']) {
    const group = page.getByRole('group', { name, exact: true })
    const trigger = group.getByTestId('lang-more-trigger')
    if (!(await trigger.isVisible())) continue
    await trigger.click()
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
    expectInside(await box(listbox), await viewportBox(page), 0, `${name} menu`)
    await page.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await expect(listbox).toBeVisible()
    // Focus moves into the open list; typing jumps to the matching option.
    await expect
      .poll(() => listbox.evaluate((l) => l.contains(document.activeElement)))
      .toBe(true)
    await page.keyboard.type('f')
    await expect(page.getByRole('option', { name: 'Français' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(
      group.getByRole('button', { name: 'Français' }),
    ).toHaveAttribute('aria-pressed', 'true')
  }
})

test('language menu typeahead matches English language names @context', async ({
  page,
}) => {
  // Narrow bars show only the selected chip, so the menus hold English and
  // Japanese (and Auto once another source is chosen).
  await page.setViewportSize({ width: 300, height: 640 })
  const bar = (name: string) => page.getByRole('group', { name, exact: true })
  const listbox = page.getByRole('listbox')
  const option = (name: string) => listbox.getByRole('option', { name, exact: true })
  async function open(name: string): Promise<void> {
    await bar(name).getByTestId('lang-more-trigger').click()
    await expect(listbox).toBeVisible()
    await expect
      .poll(() => listbox.evaluate((l) => l.contains(document.activeElement)))
      .toBe(true)
  }
  async function close(name: string): Promise<void> {
    await page.keyboard.press('Escape')
    await expect(bar(name).getByTestId('lang-more-trigger')).toHaveAttribute('aria-expanded', 'false')
  }

  // 日本語 is found by "Japanese".
  await open('Target language')
  await expect(option('English')).toHaveCount(1)
  await page.keyboard.press('j')
  await expect(option('日本語')).toBeFocused()
  await close('Target language')
  // The search starts at the first option (no active one yet).
  await open('Target language')
  await page.keyboard.press('e')
  await expect(option('English')).toBeFocused()
  await close('Target language')

  // Source English, then Auto joins the menu: its name is not "Auto…".
  await open('Source language')
  await page.keyboard.press('e')
  await expect(option('English')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(bar('Source language').getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
  await open('Source language')
  await expect(option('Auto')).toHaveCount(1)
  await page.keyboard.press('a')
  await expect(option('Auto')).not.toBeFocused()
  await page.keyboard.press('Enter')
  await close('Source language')
  await expect(bar('Source language').getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
})
