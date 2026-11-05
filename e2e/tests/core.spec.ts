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

test('swap button shows the busy spinner while streaming @core', async ({
  page,
  fake,
}) => {
  const swap = page.locator('.swap-button')
  // Both icons stay mounted; the idle one is hidden.
  const icon = (name: 'swap' | 'busy') =>
    swap.locator(
      name === 'busy' ? '.lucide-loader-circle' : '.lucide-arrow-right-left',
    )
  await expect(icon('swap')).toBeVisible()
  await expect(icon('busy')).toBeHidden()
  await fillSource(page, sentence('slow'))
  await expect(page.locator('.output-panel[aria-busy="true"]')).toHaveCount(1, {
    timeout: 15_000,
  })
  await expect(icon('busy')).toBeVisible()
  await expect(icon('swap')).toBeHidden()
  await stopStream(page, fake, 0)
  await expect(icon('swap')).toBeVisible()
  await expect(icon('busy')).toBeHidden()
})

test('streaming status names polishing for same-language input @core', async ({
  page,
  fake,
}) => {
  await pickLanguage(page, 'target', 'ko')
  await fillSource(page, sentence('slow'))
  await expect(page.getByRole('status')).toHaveText(STRINGS.en.streaming, {
    timeout: 15_000,
  })
  await stopStream(page, fake, 0)
  await expect(page.getByRole('status')).toHaveCount(0)
  // Source English to target English polishes the text.
  await pickLanguage(page, 'target', 'en')
  test.skip(
    !(await languageChip(page, 'source', 'auto').isVisible()),
    'this layout hides the source language bar',
  )
  await pickLanguage(page, 'source', 'en')
  await fillSource(page, sentence('slow'))
  await expect(page.getByRole('status')).toHaveText(STRINGS.en.polishing, {
    timeout: 15_000,
  })
  await stopStream(page, fake, 1)
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
  await waitForDone(page)
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
  await waitForDone(page)
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
  await waitForDone(page)
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
  await waitForDone(page)
})

test('cmd+enter replaces the pending debounce @core', async ({
  page,
  fake,
}) => {
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

test('a run stopped mid-alternatives keeps its completed rows and drops the skeleton @core', async ({
  page,
  fake,
}) => {
  // skeleton.json hangs inside alternatives[1].text.
  await fillSource(page, sentence('skeleton'))
  await expect(page.locator('.alternative-skeleton')).toHaveCount(1, {
    timeout: 20_000,
  })
  await expect(page.getByTestId('alternative-item')).toHaveCount(1)
  const before = await fake.stats()
  // An edit stops the run at once; read the result before its debounced
  // re-run replaces it.
  await source(page).press('End')
  await page.keyboard.type('x')
  const shown = await page.evaluate(() => ({
    skeletons: document.querySelectorAll('.alternative-skeleton').length,
    rows: document.querySelectorAll('[data-testid="alternative-item"]').length,
  }))
  expect(shown).toEqual({ skeletons: 0, rows: 1 })
  await stopStream(page, fake, before.aborted)
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
  fake,
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

  // The UI language is part of the request: switching re-runs it. Wait for
  // that run to reach the fake and finish.
  const before = await fake.requests()
  await setUiLang(page, 'ko')
  await waitForStats(fake, (s) => s.requests > before)
  await waitForMain(page, fixture('plain').result.main!)
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

test('IME composition is not interrupted @core', async ({
  page,
  fake,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CDP IME emulation is Chromium-only')
  const first = sentence('slow')
  await fillSource(page, first)
  await expect.poll(() => mainText(page), { timeout: 15_000 }).toMatch(/\S/)
  expect(await fake.requests()).toBe(1)

  // Compose 한글 at the end while the slow stream is still running, holding
  // the last uncommitted step well past the 800ms debounce.
  await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  })
  const cdp = await page.context().newCDPSession(page)
  const compose = (text: string) =>
    cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    })
  for (const step of ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']) {
    await compose(step)
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(1_200)
  // Composition edits stop the stale stream but never start a run.
  expect(await fake.stats()).toMatchObject({ requests: 1, aborted: 1 })
  await cdp.send('Input.insertText', { text: '한글' })

  const expected = `${first}한글`
  await expect(source(page)).toHaveValue(expected)
  await waitForStats(fake, (s) => s.requests >= 2, 5_000)
  await waitForMain(page, fixture('slow').result.main!)
  const caret = await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    return [ta.value, ta.selectionStart, ta.selectionEnd]
  })
  expect(caret).toEqual([expected, expected.length, expected.length])
  expect(userText((await fake.bodies()).at(-1)!)).toContain(expected)
  await stopStream(page, fake, (await fake.stats()).aborted)
})

test('late events from a superseded run are ignored @core', async ({
  page,
  fake,
}) => {
  await recordResult(page)
  await fillSource(page, sentence('slow'))
  await expect.poll(() => mainText(page), { timeout: 15_000 }).toMatch(/\S/)
  // Mark the log at the edit's input event itself, not at some earlier
  // await, so stream updates of the old run cannot slip in between.
  await page.evaluate(() => {
    const w = window as unknown as { __resultLog: unknown[]; __editAt?: number }
    document
      .querySelector('[data-testid="input-textarea"]')!
      .addEventListener('input', () => (w.__editAt = w.__resultLog.length), {
        once: true,
      })
  })
  const second = fixture('second').result.main!
  await fillSource(page, sentence('second'))
  await expect(copyButton(page)).toBeDisabled()
  await waitForMain(page, second)
  await waitForDone(page)

  const editAt = await page.evaluate(
    () => (window as unknown as { __editAt: number }).__editAt,
  )
  const log = (await resultLog(page)).slice(editAt)
  // The new run starts with an empty main. Until then the old main never
  // grows and Copy stays off; from then on only the new result may appear,
  // and Copy only for its complete main.
  const start = log.findIndex((entry) => entry.text === '')
  expect(start).toBeGreaterThanOrEqual(0)
  for (let i = 0; i < start; i++) {
    expect(log[i]!.copy).toBe(false)
    // An aborted main freezes.
    if (i > 0)
      expect(log[i]!.text!.length).toBeLessThanOrEqual(
        log[i - 1]!.text!.length,
      )
  }
  for (const entry of log.slice(start)) {
    expect(second.startsWith(entry.text ?? '')).toBe(true)
    if (entry.copy) expect(entry.text).toBe(second)
  }
  expect(await fake.stats()).toMatchObject({ requests: 2, aborted: 1 })
})

test('stale events of a superseded run cannot touch the result @core', async ({
  page,
  fake,
}) => {
  const runInput = page.locator('#translate-form [name="run"]')
  await fillSource(page, sentence('slow'))
  await expect.poll(() => mainText(page), { timeout: 15_000 }).toMatch(/\S/)
  const old = await runInput.inputValue()
  const second = fixture('second').result.main!

  // Replay every kind of event for the old run, as if still in flight, and
  // snapshot the result after each one.
  const replay = () =>
    page.evaluate((run) => {
      const form = document.getElementById('translate-form')!
      const events: Array<[string, Record<string, string>]> = [
        ['nt-main-delta', { text: 'STALE' }],
        ['nt-main-ready', { main: 'STALE' }],
        ['nt-text-delta', { field: 'rationale', text: 'STALE' }],
        ['nt-text-delta', { field: 'formalityNote', text: 'STALE' }],
        ['nt-done', {}],
        ['nt-error', { kind: 'provider', message: 'STALE' }],
      ]
      return events.map(([name, payload]) => {
        form.dispatchEvent(
          new CustomEvent(name, {
            bubbles: true,
            detail: { data: JSON.stringify({ run, ...payload }) },
          }),
        )
        const copy = document.querySelector<HTMLButtonElement>(
          '[data-testid="output-toolbar"] [data-testid="copy-button"]',
        )!
        return {
          name,
          main:
            document.querySelector('[data-testid="main-translation"]')
              ?.textContent ?? '',
          copy: !copy.disabled,
          error: !document.getElementById('result-error')!.hidden,
          explanation:
            document.getElementById('main-explanation')?.textContent ?? '',
        }
      })
    }, old)

  await fillSource(page, sentence('second'))
  // Old run aborted, new run not started yet (debounce).
  const pending = await replay()
  await expect.poll(() => runInput.inputValue()).not.toBe(old)
  await expect.poll(() => mainText(page), { timeout: 15_000 }).toMatch(/\S/)
  // New run streaming: the old run id no longer matches.
  const streaming = await replay()
  await waitForMain(page, second)
  await waitForDone(page)

  for (const snap of [...pending, ...streaming]) {
    expect(snap.main, snap.name).not.toContain('STALE')
    expect(snap.explanation, snap.name).not.toContain('STALE')
    expect(snap.error, snap.name).toBe(false)
    if (snap.copy) expect(snap.main, snap.name).toBe(second)
  }
  for (const snap of pending) expect(snap.copy, snap.name).toBe(false)
  await expect(page.locator('#result-error')).toBeHidden()
  await expect(page.locator('#main-explanation')).not.toContainText('STALE')
  expect(await mainText(page)).toBe(second)
  expect(await fake.stats()).toMatchObject({ requests: 2, aborted: 1 })
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

test('long-form input hides alternatives @core', async ({ page, fake }) => {
  const fx = fixture('longform')
  await fillSource(
    page,
    `Hi there.\nHow are you doing today my friend ${fx.match} ${nonce()}`,
  )
  await waitForMain(page, fx.result.main!)
  await waitForDone(page)
  await expect(page.locator('.alternative-item')).toHaveCount(0)
  await expect(page.locator('.detail-alternatives')).toBeHidden()
  // The section stays mounted under `hidden`, which the DOM snapshot treats
  // as absent (not merely hidden by a CSS rule).
  expect(
    await page.evaluate(
      () =>
        [...document.querySelectorAll('.detail-alternatives')].filter(
          (e) => !e.closest('[hidden]'),
        ).length,
    ),
  ).toBe(0)
  expect(await fake.requests()).toBe(1)
})

test('a short sentence without alternatives mounts no alternatives section @core', async ({
  page,
}) => {
  // learn-long's reply has no alternatives; a short single sentence is not
  // long-form, so the section's absence comes from the empty list alone.
  await fillSource(
    page,
    `How are you ${fixture('learn-long').match} ${nonce()}`,
  )
  await waitForDone(page)
  await expect(page.locator('.alternative-item')).toHaveCount(0)
  expect(
    await page.evaluate(
      () =>
        [...document.querySelectorAll('.detail-alternatives')].filter(
          (e) => !e.closest('[hidden]'),
        ).length,
    ),
  ).toBe(0)
  // The next run with alternatives shows the section again.
  await fillSource(page, sentence('default'))
  await waitForDone(page)
  await expect(page.locator('.detail-alternatives')).toBeVisible()
  await expect(page.locator('.alternative-item')).toHaveCount(2)
})

test('retry re-runs a failed translation @core', async ({ page, fake }) => {
  await fillSource(page, sentence('error-provider'))
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 20_000 })
  await expect(alert).toContainText(STRINGS.en.translationFailed)
  await expect(alert).toContainText(STRINGS.en.errorEnvHint)
  const retry = alert.getByRole('button', { name: STRINGS.en.retry })
  await expect(retry).toHaveClass(/retry-button/)
  expect(await fake.requests()).toBe(1)
  await retry.click()
  await waitForStats(fake, (s) => s.requests === 2)
  await expect(
    alert.getByRole('button', { name: STRINGS.en.retry }),
  ).toBeVisible()
  expect(await fake.requests()).toBe(2)
})

test('swap uses the translated text when the result is current @core', async ({
  page,
  fake,
}) => {
  const main = fixture('plain').result.main!
  await pickLanguage(page, 'target', 'ko')
  await fillSource(page, sentence('plain'))
  await waitForMain(page, main)
  await waitForDone(page)
  await page.locator('.swap-button').click()
  // The translation becomes the input; the model detected English, so it is
  // the new target, and the source goes back to auto.
  await expect(source(page)).toHaveValue(main)
  await expectLanguage(page, 'target', 'en')
  if ((await languageChip(page, 'source', 'auto').count()) > 0)
    await expectLanguage(page, 'source', 'auto')
  // The swapped input runs (debounced). The server LRU may answer it when
  // another project on this worker swapped the same text first.
  await expect(listenButton(page)).toBeDisabled()
  await waitForDone(page)
  const bodies = await fake.bodies()
  if (bodies.length > 1) expect(userText(bodies[1]!)).toContain(main)
})

test('register label names the Korean speech level @core', async ({ page }) => {
  await pickLanguage(page, 'target', 'ko')
  await setTone(page, 'casual')
  await fillSource(page, sentence('plain'))
  await waitForDone(page)
  const tag = page.locator('.main-explanation .section-tag')
  await expect(tag).toHaveText('해요체')
  await expect(tag).toHaveAttribute('lang', 'ko')
  await expect(page.locator('.main-explanation')).toHaveAttribute(
    'aria-label',
    STRINGS.en.whyWording,
  )
  await setTone(page, 'friends')
  await expect(tag).toHaveText('반말', { timeout: 20_000 })
})

test('streaming deltas stay urgent and only completion starts a result transition @core', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __transitions: number }
    w.__transitions = 0
    const proto = Document.prototype as unknown as {
      startViewTransition?: (...args: unknown[]) => unknown
    }
    const original = proto.startViewTransition
    if (!original) return
    proto.startViewTransition = function (...args: unknown[]) {
      w.__transitions++
      return original.apply(this, args)
    }
  })
  // The first half needs motion allowed whatever the project emulates
  // (webkit-portrait runs with reduced motion, where none starts).
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openApp(page)
  // Count from here.
  await page.evaluate(() => {
    ;(window as unknown as { __transitions: number }).__transitions = 0
  })
  const transitions = () =>
    page.evaluate(
      () => (window as unknown as { __transitions: number }).__transitions,
    )
  const supported = await page.evaluate(
    () => 'startViewTransition' in Document.prototype,
  )
  await fillSource(page, sentence('stream'))
  // Main is complete while details still stream: no transition yet.
  await expect(copyButton(page)).toBeEnabled({ timeout: 15_000 })
  expect(await transitions()).toBe(0)
  await waitForDone(page)
  await expect.poll(transitions).toBe(supported ? 1 : 0)

  // Reduced motion: no transition starts.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await fillSource(page, sentence('plain'))
  await waitForMain(page, fixture('plain').result.main!)
  await waitForDone(page)
  expect(await transitions()).toBe(supported ? 1 : 0)
})

test('input over the limit shows a local error without a request @core', async ({
  page,
  fake,
}) => {
  const text = 'How are you doing today? '.repeat(161).trim()
  expect(text.length).toBeGreaterThan(4000)
  await fillSource(page, text)
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 5_000 })
  await expect(alert).toContainText(STRINGS.en.inputTooLong)
  await expect(alert).toContainText(
    STRINGS.en.inputTooLongHint
      .replace('{max}', '4000')
      .replace('{count}', String(text.length)),
  )
  await expect(alert.getByRole('button')).toHaveCount(0)
  expect(await fake.requests()).toBe(0)
})
