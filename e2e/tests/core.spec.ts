import {
  STRINGS,
  copyButton,
  expect,
  expectLanguage,
  expectTone,
  fillSource,
  fixture,
  languageChip,
  listenButton,
  mainText,
  mainTranslation,
  nonce,
  openApp,
  pickFromMore,
  pickLanguage,
  readClipboard,
  recordResult,
  resultLog,
  sentence,
  setTone,
  setUiLang,
  source,
  test,
  translationResult,
  typeSource,
  uiLangPressed,
  userText,
  waitForDone,
  waitForMain,
  waitForStats,
  writeClipboard,
} from './helpers'
import type { Fake, StringKey, UiLang } from './helpers'
import type { Page } from '@playwright/test'
import { APP } from '../ports'

// A run that starts within this window after a paste / blur / Cmd+Enter was
// not waiting for the 800ms debounce. Each timing test also checks the
// negative: plain typing has made no request at the same mark.
const IMMEDIATE_MS = 500

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

/** End a test that left a slow stream running, so its abort cannot land in
 * the next test's counters. */
async function stopStream(page: Page, fake: Fake, abortedBefore: number) {
  await page.getByTestId('clear-input').click()
  await waitForStats(fake, (s) => s.aborted > abortedBefore, 5_000)
}

test('streams main then details @core', async ({ page, fake }) => {
  const fx = fixture('stream')
  const main = fx.result.main!
  await recordResult(page)
  await fillSource(page, sentence('stream'))
  await waitForMain(page, main)
  await waitForDone(page)
  await expect(page.getByTestId('alternative-item')).toHaveCount(
    fx.result.alternatives!.length,
  )

  const log = await resultLog(page)
  const partials = log
    .map((entry) => entry.text)
    .filter((text): text is string => Boolean(text) && text !== main)
    .filter((text) => main.startsWith(text))
  expect(new Set(partials).size).toBeGreaterThanOrEqual(2)
  for (let i = 1; i < partials.length; i++)
    expect(partials[i]!.length).toBeGreaterThanOrEqual(partials[i - 1]!.length)
  // Main was complete before any alternative (a later detail) rendered.
  const firstComplete = log.findIndex((entry) => entry.text === main)
  expect(log[firstComplete]!.alternatives).toBe(0)
  expect(await fake.requests()).toBe(1)
})

test('copy enables at main-ready before done @core', async ({ page, fake }) => {
  const fx = fixture('slow')
  const main = fx.result.main!
  await fillSource(page, sentence('slow'))
  await expect(copyButton(page)).toBeEnabled({ timeout: 15_000 })
  // Still streaming: rationale not rendered, no alternatives, Listen waits.
  await expect(page.getByText(fx.result.rationale!)).toHaveCount(0)
  await expect(page.getByTestId('alternative-item')).toHaveCount(0)
  await expect(listenButton(page)).toBeDisabled()
  expect(await mainText(page)).toBe(main)

  await copyButton(page).click()
  expect(await readClipboard(page)).toBe(main.trim())
  await stopStream(page, fake, 0)
})

test('stale result disables copy @core', async ({ page, fake }) => {
  await fillSource(page, sentence('plain'))
  await waitForMain(page, fixture('plain').result.main!)
  await waitForDone(page)
  await expect(copyButton(page)).toBeEnabled()

  await recordResult(page)
  const second = fixture('second').result.main!
  await fillSource(page, sentence('second'))
  await expect(copyButton(page)).toBeDisabled()
  await expect(copyButton(page)).toBeEnabled({ timeout: 15_000 })
  expect(await mainText(page)).toBe(second)
  expect(await fake.requests()).toBe(2)
  // Copy never re-enabled on the old main while the new run was pending.
  const log = await resultLog(page)
  const firstDisabled = log.findIndex((entry) => !entry.copy)
  expect(firstDisabled).toBeGreaterThanOrEqual(0)
  for (const entry of log.slice(firstDisabled))
    if (entry.copy) expect(entry.text).toBe(second)
})

test('paste runs immediately @core', async ({ page, fake }) => {
  const text = sentence('plain')
  await source(page).click()
  await writeClipboard(page, text)
  const start = Date.now()
  await page.getByTestId('paste-input').click()
  await waitForStats(fake, (s) => s.requests >= 1, 5_000)
  expect(Date.now() - start).toBeLessThan(IMMEDIATE_MS)
  await expect(source(page)).toHaveValue(text)
  await waitForMain(page, fixture('plain').result.main!)
})

test('blur flushes @core', async ({ page, fake }) => {
  await typeSource(page, sentence('plain'))
  const typedAt = Date.now()
  await page.waitForTimeout(150)
  expect(await fake.requests()).toBe(0)
  const start = Date.now()
  await source(page).blur()
  await waitForStats(fake, (s) => s.requests >= 1, 5_000)
  expect(Date.now() - start).toBeLessThan(IMMEDIATE_MS)
  // Flushed before the debounce would have fired.
  expect(Date.now() - typedAt).toBeLessThan(800)
  await waitForMain(page, fixture('plain').result.main!)
  await page.waitForTimeout(1_000)
  expect(await fake.requests()).toBe(1)
})

test('cmd+enter forces @core', async ({ page, fake }) => {
  const text = sentence('plain')
  await typeSource(page, text)
  await page.waitForTimeout(150)
  expect(await fake.requests()).toBe(0)
  const start = Date.now()
  await page.keyboard.press('ControlOrMeta+Enter')
  await waitForStats(fake, (s) => s.requests >= 1, 5_000)
  expect(Date.now() - start).toBeLessThan(IMMEDIATE_MS)
  await expect(source(page)).toHaveValue(text)
  await waitForMain(page, fixture('plain').result.main!)
})

test('cmd+enter replaces the pending debounce @core', async ({
  page,
  fake,
}) => {
  test.fail(
    APP === 'ts',
    'TS app bug: the forced run leaves the 800ms debounce timer armed, which ' +
      'then aborts the forced run and sends a second, paid request.',
  )
  await typeSource(page, sentence('plain'))
  await page.keyboard.press('ControlOrMeta+Enter')
  await waitForStats(fake, (s) => s.requests >= 1, 5_000)
  await waitForMain(page, fixture('plain').result.main!)
  await waitForDone(page)
  await page.waitForTimeout(1_000)
  expect(await fake.stats()).toMatchObject({ requests: 1, aborted: 0 })
})

test('enter inserts newline @core', async ({ page, fake }) => {
  const first = sentence('plain')
  await typeSource(page, first)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(IMMEDIATE_MS)
  expect(await fake.requests()).toBe(0)
  await page.keyboard.type('second line')
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(IMMEDIATE_MS)
  expect(await fake.requests()).toBe(0)
  await page.keyboard.type('third line')
  await expect(source(page)).toHaveValue(`${first}\nsecond line\nthird line`)
  await waitForStats(fake, (s) => s.requests >= 1, 5_000)
  await waitForDone(page)
  expect(await fake.requests()).toBe(1)
})

test('editing mid-stream cancels upstream @core', async ({ page, fake }) => {
  await fillSource(page, sentence('slow'))
  await expect.poll(() => mainText(page), { timeout: 15_000 }).toMatch(/\S/)
  const before = await fake.stats()
  expect(before.requests).toBe(1)
  expect(before.aborted).toBe(0)

  await fillSource(page, sentence('second'))
  await waitForStats(fake, (s) => s.aborted >= 1, 2_000)
  await waitForMain(page, fixture('second').result.main!)
  await waitForDone(page)
  const after = await fake.stats()
  expect(after.requests).toBe(2)
  expect(after.aborted).toBe(1)
})

test('repeat is served from cache @core', async ({ page, fake }) => {
  const text = sentence('plain')
  const main = fixture('plain').result.main!
  await fillSource(page, text)
  await waitForMain(page, main)
  await waitForDone(page)
  expect(await fake.requests()).toBe(1)

  await page.getByTestId('clear-input').click()
  await expect(source(page)).toHaveValue('')
  await expect.poll(() => mainText(page)).not.toBe(main)
  await fillSource(page, text)
  await waitForMain(page, main)
  await waitForDone(page)
  expect(await fake.requests()).toBe(1)
})

async function expectLocalizedErrors(
  page: Page,
  fake: Fake,
  kinds: Array<[string, StringKey]>,
) {
  const alert = translationResult(page).getByRole('alert')
  for (const ui of ['en', 'ko'] as UiLang[]) {
    if (ui === 'ko') {
      // Clear first: switching the UI language re-runs the current text.
      await page.getByTestId('clear-input').click()
      await setUiLang(page, 'ko')
    }
    for (const [name, key] of kinds) {
      await fillSource(
        page,
        `Please translate this sentence ${fixture(name).match} ${nonce()}`,
      )
      await expect(alert).toContainText(STRINGS[ui][key])
      await expect(copyButton(page)).toBeDisabled()
    }
  }
  // One upstream call per attempt: no automatic retries.
  expect(await fake.requests()).toBe(kinds.length * 2)
}

test('provider error is localized and not retried @core', async ({
  page,
  fake,
}) => {
  await expectLocalizedErrors(page, fake, [
    ['error-provider', 'translationFailed'],
  ])
})

test('error kinds are localized @core', async ({ page, fake }) => {
  test.fail(
    APP === 'ts',
    'TS app bug: on the streaming path the AI SDK surfaces upstream HTTP ' +
      'errors as NoOutputGeneratedError without a cause, so ' +
      'classifyTranslationError returns "provider" and every kind shows ' +
      '"Translation failed."',
  )
  await expectLocalizedErrors(page, fake, [
    ['error-budget', 'providerBudgetUnavailable'],
    ['error-rate', 'providerRateLimited'],
    ['error-auth', 'providerAuthenticationFailed'],
    ['error-model', 'providerModelInvalid'],
    ['error-provider', 'translationFailed'],
  ])
})

test('textarea survives streaming and UI language switch @core', async ({
  page,
}) => {
  await page.evaluate(() => {
    ;(window as unknown as { __ta: Element | null }).__ta =
      document.querySelector('[data-testid="input-textarea"]')
  })
  const text = sentence('plain')
  await fillSource(page, text)
  await waitForMain(page, fixture('plain').result.main!)
  await waitForDone(page)
  await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    ta.focus()
    ta.setSelectionRange(5, 9)
  })

  await setUiLang(page, 'ko')
  await waitForDone(page)
  const state = await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    return {
      same: ta === (window as unknown as { __ta: Element | null }).__ta,
      connected: ta.isConnected,
      value: ta.value,
      start: ta.selectionStart,
      end: ta.selectionEnd,
    }
  })
  expect(state).toEqual({
    same: true,
    connected: true,
    value: text,
    start: 5,
    end: 9,
  })
})

test('preferences persist @core', async ({ page, context }) => {
  await setTone(page, 'professional')
  await expectTone(page, 'professional')
  await pickLanguage(page, 'target', 'en')
  await setUiLang(page, 'ko')

  await page.reload({ waitUntil: 'networkidle' })
  await expectTone(page, 'professional', 'ko')
  await expectLanguage(page, 'target', 'en', 'ko')
  await uiLangPressed(page, 'ko')
  const cookies = await context.cookies()
  expect(cookies.map((c) => c.name)).toContain('nt.preferences')
})

test('auto source flips target @core', async ({ page, fake }) => {
  // Short stacked layouts drop the source language header; Auto is the
  // default source there, and the request body below proves it.
  if ((await languageChip(page, 'source', 'auto').count()) > 0)
    await expectLanguage(page, 'source', 'auto')
  await pickLanguage(page, 'target', 'en')
  await fillSource(page, sentence('plain'))
  await expectLanguage(page, 'target', 'ko')
  await waitForStats(fake, (s) => s.requests >= 1)
  await waitForDone(page)
  const bodies = await fake.bodies()
  expect(bodies).toHaveLength(1)
  const prompt = JSON.stringify(bodies[0]!.input)
  expect(prompt).toContain('Detect the source language yourself')
  expect(prompt).toContain('to Korean.')
  expect(prompt).not.toContain('to English.')
})

test('more languages listbox @core', async ({ page }) => {
  await pickFromMore(page, 'target', 'fr')
  await expectLanguage(page, 'target', 'fr')
  // fr is now the recent chip: it stays after selecting a fixed language.
  await pickLanguage(page, 'target', 'ko')
  await expect(languageChip(page, 'target', 'fr')).toHaveCount(1)
  await expect(languageChip(page, 'target', 'fr')).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  await page.reload({ waitUntil: 'networkidle' })
  await expect(languageChip(page, 'target', 'fr')).toHaveCount(1)
  await pickLanguage(page, 'target', 'fr')
  await page.reload({ waitUntil: 'networkidle' })
  await expectLanguage(page, 'target', 'fr')
})

test('markup renders as text @core', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  const fx = fixture('markup')
  await fillSource(page, sentence('markup'))
  await waitForMain(page, fx.result.main!)
  await waitForDone(page)

  const result = translationResult(page)
  await expect(result.locator('img, script, b')).toHaveCount(0)
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await expect(mainTranslation(page)).toContainText(
    '<img src=x onerror=alert(1)>',
  )
  await expect(page.getByTestId('alternative-item').first()).toContainText(
    fx.result.alternatives![0]!.text,
  )
  expect(dialogs).toEqual([])
})

test('word input uses word intent @core', async ({ page, fake }) => {
  const fx = fixture('word')
  // `thanks` plus the fixture marker (the fake needs it to answer with a word
  // result) and a nonce glued on, so detectIntent still sees two tokens.
  const text = `thanks ${fx.match}${nonce().slice(0, 5)}`
  await fillSource(page, text)
  await waitForMain(page, fx.result.primaryTranslation!)
  await waitForDone(page)
  const bodies = await fake.bodies()
  expect(bodies).toHaveLength(1)
  const format = (bodies[0]!.text as { format: { name: string } }).format
  expect(format.name).toBe('word_translation')
  expect(userText(bodies[0]!)).toContain(text)
})
