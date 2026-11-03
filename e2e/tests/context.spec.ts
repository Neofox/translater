// Reply context (@context): ContextField.tsx's toggle and field, kept in
// sessionStorage for the tab and sent with every run.
import type { Page } from '@playwright/test'
import {
  userText,
  expect,
  fillSource,
  openApp,
  sentence,
  source,
  test,
  waitForDone,
  waitForStats,
} from './helpers'

const toggle = (page: Page) => page.getByTestId('context-toggle')
const field = (page: Page) => page.getByTestId('context-textarea')

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
  // Source first: short split panes give the open context field the room.
  await fillSource(page, sentence('default'))
  await openContext(page)
  await field(page).fill('Thanks for yesterday.')
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('nt.context')))
    .toBe('"Thanks for yesterday."')
  await page.getByTestId('clear-input').click()
  await expect(source(page)).toHaveValue('')
  await expect(source(page)).toBeFocused()
  await expect(field(page)).toBeVisible()
  await expect(field(page)).toHaveValue('Thanks for yesterday.')
})
