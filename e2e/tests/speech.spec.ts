// Listen (@speech): the Listen buttons and web/static/js/speech.js. Main and
// alternative buttons share one page-wide voice; speech streams from the
// worker's fake upstream (POST /speech)
// and plays through synthetic Web Audio (syntheticAudio.ts), so the test
// decides when an unlock resolves and when scheduled audio ends. Never a paid
// call: the fake counts every upstream speech request.
import type { Locator, Page } from '@playwright/test'
import {
  STRINGS,
  expect,
  fillSource,
  fixture,
  listenButton,
  expectLanguage,
  mainTranslation,
  nonce,
  openApp,
  pickLanguage,
  sentence,
  setUiLang,
  source,
  test,
  waitForDone,
  waitForStats,
} from './helpers'
import type { Fake, UiLang } from './helpers'
import {
  audioState,
  finishAudio,
  installSyntheticAudio,
  releaseAudio,
} from './syntheticAudio'
import type { AudioOptions } from './syntheticAudio'

const alternativeListen = (page: Page, index: number): Locator =>
  page.getByTestId('alternative-item').nth(index).getByTestId('listen-button')

async function open(page: Page, options: AudioOptions = {}): Promise<void> {
  await installSyntheticAudio(page, options)
  await openApp(page)
}

/** Korean input for `name`'s fixture: Auto detects Korean and flips the
 * target to English (no source chip needed: short layouts hide that row). */
async function translateKorean(page: Page, name: string): Promise<void> {
  await fillSource(
    page,
    `오늘 어떻게 지내요 친구 ${fixture(name).match} ${nonce()}`,
  )
  await expectLanguage(page, 'target', 'en')
  await waitForDone(page)
}

/** Translate `name`'s fixture and wait for the whole result. */
async function translate(page: Page, name: string): Promise<void> {
  await fillSource(page, sentence(name))
  await waitForDone(page)
}

async function expectIdle(button: Locator, ui: UiLang = 'en'): Promise<void> {
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect(button).toHaveAttribute('aria-busy', 'false')
  await expect(button).toHaveAccessibleName(STRINGS[ui].listen)
}

async function expectLoading(button: Locator, ui: UiLang = 'en') {
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(button).toHaveAccessibleName(STRINGS[ui].speechLoading)
}

async function expectPlaying(button: Locator, ui: UiLang = 'en') {
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(button).toHaveAttribute('aria-busy', 'false')
  await expect(button).toHaveAccessibleName(STRINGS[ui].stopListening)
}

/** Play `button` to the end of its audio and expect a clean idle state. */
async function playThrough(page: Page, button: Locator): Promise<void> {
  await button.click()
  await expectPlaying(button)
  await finishAudio(page)
  await expectIdle(button)
  await expect(page.getByRole('status').filter({ hasText: /./ })).toHaveCount(0)
}

/** Upstream speech inputs, oldest first (the fake keeps the last five). */
async function spokenInputs(fake: Fake): Promise<unknown[]> {
  return (await fake.speechBodies()).map((body) => body.input)
}

async function closedContexts(page: Page): Promise<boolean[]> {
  return (await audioState(page)).contexts.map((c) => c.closed)
}

test('listen never autoplays and is disabled until the result completes @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await expect(listenButton(page)).toBeDisabled()
  // skeleton.json hangs inside the second alternative: main and the first
  // alternative are visible, the whole result never completes.
  await fillSource(page, sentence('skeleton'))
  await expect(page.getByTestId('alternative-item')).toHaveCount(1, {
    timeout: 20_000,
  })
  await expect(mainTranslation(page)).not.toBeEmpty()
  await expect(listenButton(page)).toBeDisabled()
  await expect(alternativeListen(page, 0)).toBeDisabled()
  await translate(page, 'default')
  for (const button of await page
    .getByTestId('alternative-item')
    .getByTestId('listen-button')
    .all())
    await expect(button).toBeEnabled()
  await expectIdle(listenButton(page))
  expect((await fake.stats()).speechRequests).toBe(0)
  expect((await audioState(page)).contexts).toHaveLength(0)
})

test('listen stops explicitly, completes after audio ends, and replays without a new request @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await translate(page, 'default')
  const listen = listenButton(page)
  await listen.click()
  await expectPlaying(listen)
  await listen.click()
  await expectIdle(listen)
  expect(await closedContexts(page)).toEqual([true])
  await listen.click()
  await expectPlaying(listen)
  // Network done, scheduled audio still playing: Stop stays offered. (The
  // stopped first play may already have completed its download and been
  // cached: this play then made no request.)
  await waitForStats(fake, (s) => s.active === 0)
  await expectPlaying(listen)
  await finishAudio(page)
  await expectIdle(listen)
  await expect.poll(() => closedContexts(page)).toEqual([true, true])
  const requests = (await fake.stats()).speechRequests
  expect([1, 2]).toContain(requests)
  await listen.click()
  await expectPlaying(listen)
  await finishAudio(page)
  await expectIdle(listen)
  expect((await fake.stats()).speechRequests).toBe(requests)
  expect(new Set(await spokenInputs(fake))).toEqual(
    new Set([fixture('default').result.main]),
  )
})

test('starting another voice stops the current one @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await translate(page, 'default')
  const main = listenButton(page)
  const alternative = alternativeListen(page, 0)
  await main.click()
  await expectPlaying(main)
  await alternative.click()
  await expectPlaying(alternative)
  await expectIdle(main)
  await expect.poll(() => closedContexts(page)).toEqual([true, false])
  await expect(
    page.locator('[data-testid="listen-button"][aria-pressed="true"]'),
  ).toHaveCount(1)
  await finishAudio(page)
  await expectIdle(alternative)
  expect((await fake.stats()).speechRequests).toBe(2)
})

test('pronounces sentence alternatives without overlapping the main voice @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await translate(page, 'default')
  const alternatives = fixture('default').result.alternatives!
  const second = alternativeListen(page, 1)
  await second.click()
  await expectPlaying(second)
  await listenButton(page).click()
  await expectPlaying(listenButton(page))
  await expectIdle(second)
  await expect.poll(() => closedContexts(page)).toEqual([true, false])
  await finishAudio(page)
  await expectIdle(listenButton(page))
  expect(await spokenInputs(fake)).toEqual([
    alternatives[1]!.text,
    fixture('default').result.main,
  ])
  const body = (await fake.speechBodies())[0]!
  expect(body.instructions).toContain('Korean')
})

test('pronounces word alternatives without overlapping the main voice @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await fillSource(page, '[fx:word] thanks')
  await waitForDone(page)
  const word = fixture('word').result as {
    primaryTranslation: string
    alternativeTranslations: Array<{ text: string }>
  }
  await listenButton(page).click()
  await expectPlaying(listenButton(page))
  const third = alternativeListen(page, 2)
  await third.click()
  await expectPlaying(third)
  await expectIdle(listenButton(page))
  await finishAudio(page)
  await expectIdle(third)
  expect(await spokenInputs(fake)).toEqual([
    word.primaryTranslation,
    word.alternativeTranslations[2]!.text,
  ])
})

test('another speaker aborts the connecting one @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await translate(page, 'speech-slow')
  const main = listenButton(page)
  await main.click()
  await expectLoading(main)
  await waitForStats(fake, (s) => s.speechRequests === 1)
  const alternative = alternativeListen(page, 0)
  await alternative.click()
  await expectLoading(alternative)
  await expectIdle(main)
  await waitForStats(fake, (s) => s.speechAborted === 1)
  await expect.poll(() => closedContexts(page)).toEqual([true, false])
  // The alternative's own request is the second, still connecting.
  await waitForStats(fake, (s) => s.speechRequests === 2)
  await alternative.click()
  await expectIdle(alternative)
  await waitForStats(fake, (s) => s.speechAborted === 2 && s.active === 0)
})

test('stop during slow unlock sends no request @speech', async ({
  page,
  fake,
}) => {
  await open(page, { holdResume: true })
  await translate(page, 'default')
  const main = listenButton(page)
  await main.click()
  await expectLoading(main)
  await main.click()
  await expectIdle(main)
  // The unlock resolves after Stop: the stopped tap must not fetch.
  await releaseAudio(page)
  // A later tap is a sync point: its request is the first and only one.
  const alternative = alternativeListen(page, 0)
  await alternative.click()
  await expectPlaying(alternative)
  await finishAudio(page)
  await expectIdle(alternative)
  expect((await fake.stats()).speechRequests).toBe(1)
  expect(await spokenInputs(fake)).toEqual([
    fixture('default').result.alternatives![0]!.text,
  ])
  expect(await closedContexts(page)).toEqual([true, true])
  // Both unlocks ran synchronously inside their taps (iPhone requires it).
  const gestures = (await audioState(page)).contexts.map((c) => c.inGesture)
  expect(gestures).toEqual([
    { created: true, resume: true },
    { created: true, resume: true },
  ])
})

test('editing input cancels playback and switching sentence to word resets the result @speech', async ({
  page,
}) => {
  await open(page)
  await translate(page, 'default')
  const listen = listenButton(page)
  await listen.click()
  await expectPlaying(listen)
  await source(page).press('End')
  await page.keyboard.type(' x')
  await expect(listen).toBeDisabled()
  await expectIdle(listen)
  await expect.poll(() => closedContexts(page)).toEqual([true])
  await fillSource(page, '[fx:word] thanks')
  await waitForDone(page)
  await expect(mainTranslation(page)).toHaveText(
    fixture('word').result.primaryTranslation!,
  )
  await expect(page.getByTestId('refine-chip-softer')).toHaveCount(0)
  await listen.click()
  await expectPlaying(listen)
  // A new pending result cancels speech.
  await fillSource(page, sentence('slow'))
  await expect(listen).toBeDisabled()
  await expectIdle(listen)
  await expect.poll(() => closedContexts(page)).toEqual([true, true])
})

test('changing the target language aborts a connecting speech request @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await translate(page, 'speech-slow')
  const listen = listenButton(page)
  await listen.click()
  await expectLoading(listen)
  await waitForStats(fake, (s) => s.speechRequests === 1)
  await pickLanguage(page, 'target', 'fr')
  await expectIdle(listen)
  await waitForStats(fake, (s) => s.speechAborted === 1)
  expect(await closedContexts(page)).toEqual([true])
})

test('pagehide cancels playback @speech', async ({ page }) => {
  await open(page)
  await translate(page, 'default')
  const listen = listenButton(page)
  await listen.click()
  await expectPlaying(listen)
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pagehide', { persisted: true }),
    ),
  )
  await expectIdle(listen)
  expect(await closedContexts(page)).toEqual([true])
  // Returning still needs another explicit tap.
  await expect(listen).toBeEnabled()
})

test('oversized text shows speechTooLong without unlocking or a request @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await translate(page, 'speech-long')
  const listen = listenButton(page)
  await listen.click()
  const status = page.getByTestId('output-toolbar').getByRole('status')
  await expect(status).toHaveText(STRINGS.en.speechTooLong)
  await expect(listen).toHaveAttribute(
    'aria-describedby',
    (await status.getAttribute('id'))!,
  )
  await expectIdle(listen)
  expect((await audioState(page)).contexts).toHaveLength(0)
  expect((await fake.stats()).speechRequests).toBe(0)
})

for (const ui of ['en', 'ko'] as const) {
  test(`speech failure shows a localized notice without provider text (${ui}) @speech`, async ({
    page,
    fake,
  }) => {
    await open(page)
    if (ui === 'ko') await setUiLang(page, 'ko')
    await translate(page, 'speech-error')
    const listen = listenButton(page)
    await listen.click()
    const status = page.getByTestId('output-toolbar').getByRole('status')
    await expect(status).toHaveText(STRINGS[ui].speechFailed)
    await expect(status).toHaveAttribute('title', STRINGS[ui].speechFailed)
    await expectIdle(listen, ui)
    await expect(page.locator('body')).not.toContainText('SECRET-PROVIDER-TEXT')
    expect((await fake.stats()).speechRequests).toBe(1)
    expect(await closedContexts(page)).toEqual([true])
    // The next tap starts over without the old notice.
    await listen.click()
    await expect(status).toHaveText(STRINGS[ui].speechFailed)
    await expect(
      page.getByTestId('output-toolbar').getByRole('status'),
    ).toHaveCount(1)
  })
}

test('replay cache evicts beyond 3 entries @speech', async ({ page, fake }) => {
  await open(page)
  await translate(page, 'default')
  // Three completed entries: main, alternative 0, alternative 1.
  for (const button of [
    listenButton(page),
    alternativeListen(page, 0),
    alternativeListen(page, 1),
  ])
    await playThrough(page, button)
  // A replay refreshes main: alternative 0 is now the oldest.
  await playThrough(page, listenButton(page))
  expect((await fake.stats()).speechRequests).toBe(3)
  // A fourth entry evicts alternative 0.
  await translate(page, 'speech-en')
  await playThrough(page, alternativeListen(page, 0))
  expect((await fake.stats()).speechRequests).toBe(4)
  await translate(page, 'default')
  await playThrough(page, alternativeListen(page, 1))
  expect((await fake.stats()).speechRequests).toBe(4)
  await playThrough(page, alternativeListen(page, 0))
  expect((await fake.stats()).speechRequests).toBe(5)
})

test('replay cache evicts beyond 4 MiB @speech', async ({ page, fake }) => {
  await open(page)
  await translate(page, 'speech-big')
  // 2.5 MiB each: the second entry pushes the first out.
  await playThrough(page, listenButton(page))
  await playThrough(page, alternativeListen(page, 0))
  expect((await fake.stats()).speechRequests).toBe(2)
  await playThrough(page, alternativeListen(page, 0))
  expect((await fake.stats()).speechRequests).toBe(2)
  await playThrough(page, listenButton(page))
  expect((await fake.stats()).speechRequests).toBe(3)
})

test('identical text in different languages is cached separately @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await translate(page, 'default')
  await playThrough(page, listenButton(page))
  await playThrough(page, listenButton(page))
  expect((await fake.stats()).speechRequests).toBe(1)
  // speech-en reports the same main text in English.
  await translateKorean(page, 'speech-en')
  await expect(mainTranslation(page)).toHaveText(
    fixture('default').result.main!,
  )
  await playThrough(page, listenButton(page))
  expect((await fake.stats()).speechRequests).toBe(2)
})

// The fallback to `auto` for a language outside the list is a unit test
// (speech.test.js): no fixture can report one (the schema enum).
test('sends the result language @speech', async ({ page, fake }) => {
  await open(page)
  await translate(page, 'default')
  await playThrough(page, listenButton(page))
  await translateKorean(page, 'speech-en')
  await playThrough(page, alternativeListen(page, 0))
  const [korean, english] = await fake.speechBodies()
  expect(korean!.instructions).toBe(
    'Read the text aloud in Korean with natural native pronunciation, at a clear, relaxed pace.',
  )
  expect(english!.instructions).toBe(
    'Read the text aloud in English with natural native pronunciation, at a clear, relaxed pace.',
  )
})

// The model-reported targetLang, not the selected target,
// sets the main text's lang, the register label (Korean sentences only) and
// the Listen language. target-lang.json reports French with Korean selected.
test('the reported target language drives lang, register label and Listen @speech', async ({
  page,
  fake,
}) => {
  await open(page)
  await translate(page, 'default')
  await expect(mainTranslation(page)).toHaveAttribute('lang', 'ko')
  await expect(page.locator('.main-explanation .section-tag')).toHaveText(
    '해요체',
  )
  await translate(page, 'target-lang')
  await expectLanguage(page, 'target', 'ko')
  await expect(mainTranslation(page)).toHaveText(
    fixture('target-lang').result.main!,
  )
  await expect(mainTranslation(page)).toHaveAttribute('lang', 'fr')
  await expect(page.locator('.main-explanation p')).toBeVisible()
  await expect(page.locator('.main-explanation .section-tag')).toHaveCount(0)
  await playThrough(page, listenButton(page))
  const [french] = await fake.speechBodies()
  expect(french!.instructions).toBe(
    'Read the text aloud in French with natural native pronunciation, at a clear, relaxed pace.',
  )
})

for (const ui of ['en', 'ko'] as const) {
  test(`labelled speech actions fit their box while loading and playing (${ui}) @speech`, async ({
    page,
  }, testInfo) => {
    // Labels show in the desktop workspace; compact docks are icon-only.
    test.skip(
      !testInfo.project.name.endsWith('macbook-14'),
      'labelled result actions are the desktop workspace',
    )
    await open(page, { holdResume: true })
    if (ui === 'ko') await setUiLang(page, 'ko')
    await translate(page, 'default')
    const listen = listenButton(page)
    const box = () =>
      listen.evaluate((button) => ({
        width: button.getBoundingClientRect().width,
        fits: button.scrollWidth <= button.clientWidth,
      }))
    const initial = await box()
    await listen.click()
    await expectLoading(listen, ui)
    await expect(listen).toContainText(STRINGS[ui].stopSpeech)
    expect(await box()).toEqual({ ...initial, fits: true })
    await releaseAudio(page)
    await expectPlaying(listen, ui)
    await expect(listen).toContainText(STRINGS[ui].stopSpeech)
    expect(await box()).toEqual({ ...initial, fits: true })
    await finishAudio(page)
    await expectIdle(listen, ui)
    await expect(listen).toContainText(STRINGS[ui].listen)
  })
}

test('dock speech failures stay visible inside the result pane @speech', async ({
  page,
}) => {
  await open(page)
  await translate(page, 'speech-error')
  await listenButton(page).click()
  const status = page.getByTestId('output-toolbar').getByRole('status')
  await expect(status).toBeVisible()
  const panel = (await page.locator('.output-panel').boundingBox())!
  const bounds = (await status.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(panel.y)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(panel.y + panel.height)
  expect(bounds.x).toBeGreaterThanOrEqual(panel.x)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(panel.x + panel.width)
})
