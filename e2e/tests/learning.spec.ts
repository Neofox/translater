// Learning in the initial response (@learning): LearningInspector.tsx's
// whole-message rows, InspectableTranslation.tsx's grammar phrases and
// selected mark, SourceHighlight.tsx's source mirror. Ports of
// tests/browser/learning.browser.tsx.
//
// The rows show in the reference pane of the desktop workspace once the
// result is done; every other layout shows them in the learning surface,
// which a tap on the main text opens (openOverview, as in the TS test).
//
// Inspection gestures (phrasePointer.ts, InspectableTranslation.tsx,
// SourceHighlight.tsx): a short stationary tap inspects after a 400 ms
// selection grace period; drag, long press and double-click keep native
// selection and editing.
import type { Page } from '@playwright/test'
import { installFakeVisualViewport } from '../perf/page-scripts'
import {
  STRINGS,
  copyButton,
  expect,
  fillSource,
  fixture,
  listenButton,
  mainTranslation,
  nonce,
  openApp,
  readClipboard,
  sentence,
  setUiLang,
  source,
  test,
  translationResult,
  waitForDone,
  waitForMain,
} from './helpers'

const rows = (page: Page) => page.getByTestId('learning-chunk')
const mirror = (page: Page) => page.getByTestId('source-highlight')

/** The desktop workspace (`desktop` in useWorkspaceLayout.ts). */
async function isDesktop(page: Page): Promise<boolean> {
  return (
    (await page.locator('.translator-panels').getAttribute('data-desktop')) ===
    'true'
  )
}

async function inspectables(page: Page): Promise<string[]> {
  return mainTranslation(page)
    .getByTestId('inspectable-phrase')
    .allTextContents()
}

async function mirrorText(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document
        .querySelector('[data-testid="source-highlight"]')
        // The mirror ends with a zero-width space (U+200B).
        ?.textContent.replaceAll(String.fromCharCode(0x200b), '') ?? null,
  )
}

/** A Korean source for `name`'s ko→en fixture: auto source, routed to
 * English. The Korean filler keeps Hangul ahead of the marker's and nonce's
 * Latin letters, so the script heuristic agrees with the model's report and
 * no run is re-routed (short landscape layouts hide the source bar). */
function koreanInput(name: string, text: string): string {
  return `${text} ${fixture(name).match} ${nonce()} 다시 한 번 진심으로 감사드립니다 여러분`
}

async function readKorean(page: Page, name: string, text: string) {
  const input = koreanInput(name, text)
  await fillSource(page, input)
  await waitForDone(page)
  return input
}

const DEFAULT_MAIN = '오늘 어떻게 지내요?'

const panel = (page: Page) => page.getByTestId('learning-panel')
const visibleDetails = (page: Page) =>
  page.locator('.phrase-detail').filter({ visible: true })

/** The whole-message rows (TS openOverview): compact layouts open the
 * learning surface with a tap on the main text, then any phrase the tap
 * selected collapses. */
async function openOverview(page: Page) {
  if (!(await isDesktop(page))) {
    // On the text itself: a short main line ends before the paragraph's
    // centre, and a tap past the end of the text does not inspect.
    if (!(await panel(page).isVisible())) {
      await transitionsDone(page)
      await mainTranslation(page).click({ position: { x: 4, y: 8 } })
    }
    await expect(panel(page)).toBeVisible()
  }
  const expanded = page.locator(
    '[data-testid="learning-chunk"][aria-expanded="true"]',
  )
  if (await expanded.count()) await expanded.first().click()
  await expect(expanded).toHaveCount(0)
}

async function closeLearning(page: Page) {
  if (await panel(page).isVisible())
    await page
      .getByRole('button', { name: STRINGS.en.closeLearning, exact: true })
      .click()
  await expect(panel(page)).toBeHidden()
}

/** Centre of the `nth` source grammar underline, relative to the textarea
 * (sourceGrammarPosition in the TS test). */
async function grammarPosition(page: Page, nth = 0) {
  return page.evaluate((index) => {
    const grammar = document.querySelectorAll('[data-testid="source-grammar"]')[
      index
    ]!
    const field = document
      .querySelector('[data-testid="input-textarea"]')!
      .getBoundingClientRect()
    // A wrapped underline has a rectangle per line; take one the editor
    // shows (a short editor scrolls its first lines away).
    const rects = [...grammar.getClientRects()]
    const rect =
      rects.find(
        (r) =>
          r.top + r.height / 2 > field.top &&
          r.top + r.height / 2 < field.bottom,
      ) ?? rects[0]!
    return {
      x: rect.left + rect.width / 2 - field.left,
      y: rect.top + rect.height / 2 - field.top,
    }
  }, nth)
}

type Editor = {
  same: boolean
  focused: boolean
  value: string
  caret: [number, number]
  scroll: number
}

/** Marks the textarea node so later reads can tell it was never replaced. */
async function markSource(page: Page) {
  await page.evaluate(() => {
    ;(
      document.querySelector('[data-testid="input-textarea"]') as unknown as {
        __t20: boolean
      }
    ).__t20 = true
  })
}

async function editor(page: Page): Promise<Editor> {
  return page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    return {
      same: (ta as unknown as { __t20?: boolean }).__t20 === true,
      focused: document.activeElement === ta,
      value: ta.value,
      caret: [ta.selectionStart, ta.selectionEnd] as [number, number],
      scroll: ta.scrollTop,
    }
  })
}

/** The learn-reading result with the editor unfocused, like a page the
 * reader comes back to (fill focuses it). */
async function readingResult(page: Page, text = '오늘 도와줘서 고마워요.') {
  const input = await readKorean(page, 'learn-reading', text)
  await source(page).blur()
  await expect(page.getByTestId('source-grammar')).toHaveCount(2)
  await markSource(page)
  return input
}

const settle = (page: Page) => page.waitForTimeout(450)

/** Waits for finite animations, the completion View Transition included.
 * While a View Transition runs, its overlay takes every pointer event (the
 * target is <html>), so a tap measured and sent then is lost.
 * Infinite pulses are skipped. */
async function transitionsDone(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) =>
          Number.isFinite(a.effect?.getComputedTiming().endTime ?? 0),
        )
        .map((a) => a.finished.catch(() => {})),
    ),
  )
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('initial phrase details reveal locally and only grammar constructions are underlined @learning', async ({
  page,
  fake,
}) => {
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  await expect.poll(() => inspectables(page)).toEqual(['지내요'])
  await expect(mainTranslation(page)).toHaveText(DEFAULT_MAIN)
  await expect(mainTranslation(page)).toHaveAttribute(
    'data-inspectable',
    'true',
  )
  await openOverview(page)
  const row = rows(page).nth(1)
  await expect(row).toContainText('어떻게 지내요')
  await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  const detail = visibleDetails(page)
  await expect(detail).toHaveCount(1)
  await expect(detail.locator('dt')).toContainText([
    STRINGS.en.inThisSentence,
    STRINGS.en.baseForm,
    STRINGS.en.grammar,
  ])
  await expect(detail.getByText('지내다', { exact: true })).toBeVisible()
  await expect(detail.locator('dd[lang="ko"]')).toHaveText('지내다')
  await expect(
    page.getByRole('button', { name: 'More detail', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByTestId('learning-detail-skeleton')).toHaveCount(0)
  // Phrase inspection is local: no request beyond the translation.
  expect(await fake.requests()).toBe(1)
})

test('English UI breaks down original Korean when translating into English @learning', async ({
  page,
}) => {
  const fx = fixture('learn-reading')
  const input = await readKorean(
    page,
    'learn-reading',
    '오늘 도와줘서 고마워요.',
  )
  await expect(mainTranslation(page)).toHaveText(fx.result.main!)
  const desktop = await isDesktop(page)
  if (desktop)
    await expect(mainTranslation(page)).not.toHaveAttribute('data-inspectable')
  else
    await expect(mainTranslation(page)).toHaveAttribute(
      'data-inspectable',
      'true',
    )
  await expect(
    mainTranslation(page).getByTestId('inspectable-phrase'),
  ).toHaveCount(0)
  // Grammar underlines in the source mirror before any selection.
  await expect(page.getByTestId('source-grammar')).toHaveText([
    '줘서',
    '고마워요',
  ])
  expect(await mirrorText(page)).toBe(input)
  const styles = await page.evaluate(() => {
    const ta = document.querySelector('[data-testid="input-textarea"]')!
    const m = document.querySelector('[data-testid="source-highlight"]')!
    const grammar = m.querySelector('[data-testid="source-grammar"]')!
    const pick = (el: Element) => {
      const s = getComputedStyle(el)
      return [s.fontSize, s.lineHeight, s.paddingLeft, s.paddingTop]
    }
    return {
      textarea: pick(ta),
      mirror: pick(m),
      pointer: getComputedStyle(m).pointerEvents,
      line: getComputedStyle(grammar).textDecorationLine,
      before: m.nextElementSibling === ta,
    }
  })
  expect(styles.mirror).toEqual(styles.textarea)
  expect(styles).toMatchObject({
    pointer: 'none',
    line: 'underline',
    before: true,
  })
  await openOverview(page)
  const row = rows(page).nth(1)
  await expect(row).toContainText('도와줘서')
  await row.click()
  if (desktop) {
    await expect.poll(() => mirrorText(page)).toBe(input)
    await expect(mirror(page).locator('mark')).toHaveText('도와줘서')
  }
  await expect(page.locator('.learning-phrase')).toHaveAttribute('lang', 'ko')
  await expect(source(page)).toHaveValue(input)
  await expect(
    page.getByText(
      '-어서 (here 줘서) attaches to 도와주다 to give the reason for the thanks.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(copyButton(page)).toBeEnabled()
})

test('Korean UI breaks down original English when translating into Korean @learning', async ({
  page,
}) => {
  await setUiLang(page, 'ko')
  await fillSource(page, sentence('learn-reading-ko'))
  await waitForDone(page)
  const desktop = await isDesktop(page)
  if (desktop)
    await expect(mainTranslation(page)).not.toHaveAttribute('data-inspectable')
  else
    await expect(mainTranslation(page)).toHaveAttribute(
      'data-inspectable',
      'true',
    )
  await expect(page.getByTestId('source-grammar')).toHaveText([
    'are you doing',
    'my',
  ])
  await openOverview(page)
  await expect(rows(page).first()).toContainText('How are you doing')
  await rows(page).first().click()
  if (desktop)
    await expect(mirror(page).locator('mark')).toHaveText('How are you doing')
  await expect(page.locator('.learning-phrase')).toHaveAttribute('lang', 'en')
})

test('whole-message breakdown keeps every phrase visible with inline details and no sentence pagination @learning', async ({
  page,
}) => {
  const line = 'Thanks for helping me today.'
  await fillSource(
    page,
    `${Array(8).fill(line).join('\n\n')}\n${fixture('learn-long').match} ${nonce()}`,
  )
  await waitForDone(page)
  // Long-form input: no alternatives, every learning fact stays in its row.
  await expect(page.getByTestId('alternative-item')).toHaveCount(0)
  await expect
    .poll(() => inspectables(page))
    .toEqual(Array(8).fill(['줘서', '고마워요']).flat())
  await openOverview(page)
  await expect(rows(page).filter({ visible: true })).toHaveCount(24)
  await expect(page.locator('.learning-sentences')).toHaveCount(0)
  const details = visibleDetails(page)
  await rows(page).nth(4).click()
  await expect(rows(page).nth(4)).toHaveAttribute('aria-expanded', 'true')
  await expect(rows(page)).toHaveCount(24)
  await expect(details).toHaveCount(1)
  await expect(
    details.getByText('도와주다 emphasizes helping another person.', {
      exact: true,
    }),
  ).toBeVisible()
  await rows(page).nth(7).click()
  await expect(rows(page).nth(7)).toHaveAttribute('aria-expanded', 'true')
  await expect(rows(page).nth(4)).toHaveAttribute('aria-expanded', 'false')
  await expect(details).toHaveCount(1)
  await rows(page).nth(7).click()
  await expect(details).toHaveCount(0)
  await expect(rows(page)).toHaveCount(24)
})

test('Breakdown action never appears before phrase details arrive or after completion @learning', async ({
  page,
}) => {
  await page.evaluate(() => {
    const log = { rowsWhileStreaming: false, breakdown: false }
    ;(window as unknown as { __learnLog: typeof log }).__learnLog = log
    new MutationObserver(() => {
      const listen = document.querySelector<HTMLButtonElement>(
        '[data-testid="output-toolbar"] [data-testid="listen-button"]',
      )
      const visibleRow = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="learning-chunk"]',
        ),
      ].some((row) => row.checkVisibility())
      if (visibleRow && listen?.disabled) log.rowsWhileStreaming = true
      if (
        document.querySelector('[data-testid="breakdown-button"]') ||
        [...document.querySelectorAll('button')].some((b) =>
          /breakdown/i.test(b.textContent),
        )
      )
        log.breakdown = true
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
  })
  await readKorean(page, 'learn-reading', '오늘 도와줘서 고마워요.')
  await openOverview(page)
  await expect(rows(page).filter({ visible: true })).toHaveCount(3)
  const log = await page.evaluate(
    () =>
      (
        window as unknown as {
          __learnLog: { rowsWhileStreaming: boolean; breakdown: boolean }
        }
      ).__learnLog,
  )
  expect(log).toEqual({ rowsWhileStreaming: false, breakdown: false })
  await expect(page.getByTestId('breakdown-button')).toHaveCount(0)
})

test('overlapping model quotes keep the remaining Korean source breakdown usable @learning', async ({
  page,
}) => {
  // Two lines: the second grammar underline comes after a newline, whose
  // form encoding must not shift it.
  await readKorean(
    page,
    'learn-overlap',
    '평면도 작성 기능을 확인해 보실 수 있는 링크를 공유드립니다.\n직접 사용해 보시고, UX 흐름이나 사용성에 관한 의견이 있으시면 편하게 알려 주세요.',
  )
  await expect(page.getByTestId('source-grammar')).toHaveText([
    '드립니다',
    '보시고',
  ])
  await openOverview(page)
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).first()).toContainText('링크를 공유드립니다')
  await rows(page).first().click()
  await expect(rows(page).first()).toHaveAttribute('aria-expanded', 'true')
  if (await isDesktop(page))
    await expect(mirror(page).locator('mark')).toHaveText('링크를 공유드립니다')
  await expect(copyButton(page)).toBeEnabled()
})

test('initial phrase inspection clears on input edits, translation errors and Clear @learning', async ({
  page,
}) => {
  const select = async () => {
    await expect.poll(() => inspectables(page)).toEqual(['지내요'])
    await openOverview(page)
    await rows(page).nth(1).click()
    await expect(page.getByTestId('selected-phrase')).toHaveText(
      '어떻게 지내요',
    )
    // The counterpart quotation is marked under the source.
    await expect(mirror(page).locator('mark')).toHaveText('How are you doing')
    await closeLearning(page)
  }
  const cleared = async () => {
    await expect(page.getByTestId('selected-phrase')).toHaveCount(0)
    await expect(page.getByTestId('inspectable-phrase')).toHaveCount(0)
    await expect(mirror(page)).toHaveCount(0)
    await expect(rows(page).filter({ visible: true })).toHaveCount(0)
  }
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  await select()
  // An edit makes the result stale at once.
  await source(page).press('End')
  await page.keyboard.type(' x')
  await expect(copyButton(page)).toBeDisabled()
  await cleared()
  await waitForDone(page)
  await select()
  await fillSource(
    page,
    `How are you doing today ${fixture('error-provider').match} ${nonce()}`,
  )
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 })
  await expect(copyButton(page)).toBeDisabled()
  await cleared()
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  await select()
  await page.getByTestId('clear-input').click()
  await expect(source(page)).toHaveValue('')
  await cleared()
})

test('learning from a superseded run is ignored @learning', async ({
  page,
  fake,
}) => {
  // English to Korean (the slow fixture's languages), with its own rows.
  await fillSource(page, sentence('slow'))
  await expect.poll(() => fake.requests()).toBe(1)
  await expect
    .poll(async () => (await mainTranslation(page).textContent())?.length ?? 0)
    .toBeGreaterThan(0)
  await expect(listenButton(page)).toBeDisabled()
  // Mid-stream edit: the slow run is aborted; the new one learns the source.
  await fillSource(
    page,
    koreanInput('learn-reading', '오늘 도와줘서 고마워요.'),
  )
  await waitForMain(page, fixture('learn-reading').result.main!)
  await waitForDone(page)
  expect(await fake.requests()).toBe(2)
  await expect(
    mainTranslation(page).getByTestId('inspectable-phrase'),
  ).toHaveCount(0)
  await expect(page.getByTestId('source-grammar')).toHaveText([
    '줘서',
    '고마워요',
  ])
  await openOverview(page)
  await expect(rows(page)).toHaveText([/^오늘/, /^도와줘서/, /^고마워요/])
})

test('no-alternatives desktop example keeps all learning facts in phrase details @learning', async ({
  page,
}) => {
  test.skip(!(await isDesktop(page)), 'desktop workspace only')
  await fillSource(
    page,
    `Thanks for helping me today.\nThanks again. ${fixture('learn-long').match} ${nonce()}`,
  )
  await waitForDone(page)
  await expect(page.getByTestId('alternative-item')).toHaveCount(0)
  await expect(page.locator('.detail-learning')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Learning tips', exact: true }),
  ).toHaveCount(0)
  const geometry = await page.evaluate(() => {
    const area = document.querySelector('.source-input-area')!
    const ta = document.querySelector('[data-testid="input-textarea"]')!
    const header = document.querySelector('.composer-header')!
    return {
      background: getComputedStyle(area).backgroundColor,
      radius: getComputedStyle(area).borderRadius,
      dx: Math.abs(
        ta.getBoundingClientRect().left - header.getBoundingClientRect().left,
      ),
    }
  })
  expect(geometry).toMatchObject({
    background: 'rgba(0, 0, 0, 0)',
    radius: '0px',
  })
  expect(geometry.dx).toBeLessThanOrEqual(1)
  const node = await source(page).elementHandle()
  await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    ta.focus()
    ta.setSelectionRange(1, 3)
  })
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('.composer')!).boxShadow,
    ),
  ).not.toBe('none')
  await expect(
    page.locator('.reference-panel [data-testid="learning-chunk"]'),
  ).toHaveCount(24)
  await rows(page).first().click()
  await expect(rows(page)).toHaveCount(24)
  const detail = page.locator('.phrase-detail').filter({ visible: true })
  await expect(detail.locator('dt')).toHaveText([
    STRINGS.en.inThisSentence,
    STRINGS.en.baseForm,
    STRINGS.en.literalMeaning,
    STRINGS.en.naturalMeaning,
  ])
  expect(
    await page.evaluate(
      (el) =>
        el === document.querySelector('[data-testid="input-textarea"]') &&
        el instanceof HTMLTextAreaElement && [
          el.selectionStart,
          el.selectionEnd,
        ],
      node,
    ),
  ).toEqual([1, 3])
})

// ----- Inspection gestures ---------------------------------------------------

test('a deliberate phrase tap selects its chunk without interfering with native selection @learning', async ({
  page,
  fake,
}) => {
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  await expect.poll(() => inspectables(page)).toEqual(['지내요'])
  const start = Date.now()
  await mainTranslation(page).getByTestId('inspectable-phrase').click()
  await expect(page.getByTestId('selected-phrase')).toHaveText('어떻게 지내요')
  // The selection grace period runs first.
  expect(Date.now() - start).toBeGreaterThanOrEqual(400)
  await expect(rows(page).nth(1)).toHaveAttribute('aria-expanded', 'true')
  await expect(
    page.getByRole('region', { name: '어떻게 지내요', exact: true }),
  ).toBeVisible()
  if (!(await isDesktop(page)))
    await expect(mainTranslation(page)).toHaveAttribute('aria-expanded', 'true')
  await closeLearning(page)
  // A native selection inside the main text still works afterwards.
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  // The phrase, or the selected mark where the desktop keeps it.
  await mainTranslation(page).locator('span, mark').first().dblclick()
  await settle(page)
  expect(
    await page.evaluate(() => window.getSelection()?.toString() ?? ''),
  ).not.toBe('')
  await expect(panel(page)).toBeHidden()
  expect(await fake.requests()).toBe(1)
})

test('deselecting native text and a long press do not inspect grammar @learning', async ({
  page,
}) => {
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  await expect.poll(() => inspectables(page)).toEqual(['지내요'])
  // Focus the frame first: Playwright's first focus transfer can clear a
  // native selection before pointerdown arrives.
  await translationResult(page).click({ position: { x: 1, y: 1 } })
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) =>
          Number.isFinite(a.effect?.getComputedTiming().endTime ?? 0),
        )
        .map((a) => a.finished.catch(() => {})),
    )
    const main = document.querySelector('[data-testid="main-translation"]')!
    const range = document.createRange()
    range.selectNodeContents(main)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    const log: boolean[] = []
    ;(window as unknown as { __selectedAtDown: boolean[] }).__selectedAtDown =
      log
    document.addEventListener(
      'pointerdown',
      () => log.push(Boolean(window.getSelection()?.toString())),
      { capture: true, once: true },
    )
  })
  await mainTranslation(page).getByTestId('inspectable-phrase').click()
  await settle(page)
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __selectedAtDown: boolean[] }).__selectedAtDown,
    ),
  ).toEqual([true])
  await expect(page.getByTestId('selected-phrase')).toHaveCount(0)
  await expect(panel(page)).toBeHidden()
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await mainTranslation(page)
    .getByTestId('inspectable-phrase')
    .click({ delay: 600 })
  await settle(page)
  await expect(page.getByTestId('selected-phrase')).toHaveCount(0)
  await expect(panel(page)).toBeHidden()
  await expect(
    page.locator('[data-testid="learning-chunk"][aria-expanded="true"]'),
  ).toHaveCount(0)
})

test('double-click selects a word without opening learning @learning', async ({
  page,
}) => {
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  await expect.poll(() => inspectables(page)).toEqual(['지내요'])
  await mainTranslation(page).getByTestId('inspectable-phrase').dblclick()
  await settle(page)
  expect(
    await page.evaluate(() => window.getSelection()?.toString() ?? ''),
  ).not.toBe('')
  await expect(page.getByTestId('selected-phrase')).toHaveCount(0)
  await expect(panel(page)).toBeHidden()
  // The source editor: double-click and long press on a grammar underline
  // keep ordinary editing.
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await readingResult(page)
  await source(page).dblclick({ position: await grammarPosition(page) })
  await settle(page)
  const doubled = await editor(page)
  expect(doubled.caret[1]).toBeGreaterThan(doubled.caret[0])
  await source(page).click({
    position: await grammarPosition(page),
    delay: 600,
  })
  await settle(page)
  await expect(visibleDetails(page)).toHaveCount(0)
  await expect(panel(page)).toBeHidden()
  expect((await editor(page)).same).toBe(true)
})

test('tapping source grammar opens its phrase and preserves the editor caret @learning', async ({
  page,
}) => {
  const input = await readingResult(page)
  await source(page).click({ position: await grammarPosition(page) })
  const caret = (await editor(page)).caret
  await expect(
    page.getByRole('region', { name: '도와줘서', exact: true }),
  ).toBeVisible()
  const opened = await editor(page)
  expect(opened).toMatchObject({ same: true, value: input, caret })
  // The desktop workspace leaves source focus in place.
  if (await isDesktop(page)) expect(opened.focused).toBe(true)
  await closeLearning(page)
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    caret,
  })
  await page.keyboard.type(' 수정')
  await expect(visibleDetails(page)).toHaveCount(0)
  await expect(mirror(page)).toHaveCount(0)
})

for (const cancelTap of [false, true])
  test(`scrolled source grammar stays accurate and scrolling cancels a pending tap (${cancelTap}) @learning`, async ({
    page,
  }) => {
    const text = `${Array(40).fill('다른 문장입니다.').join('\n')}\n오늘 도와줘서 고마워요.`
    await readingResult(page, text)
    await page.evaluate(() => {
      const ta = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="input-textarea"]',
      )!
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
      ta.scrollTop = ta.scrollHeight
    })
    const scrolled = await editor(page)
    expect(scrolled.scroll).toBeGreaterThan(0)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.querySelector('[data-testid="source-highlight"]')!
              .scrollTop,
        ),
      )
      .toBe(scrolled.scroll)
    await source(page).click({ position: await grammarPosition(page) })
    const { caret, scroll } = await editor(page)
    if (cancelTap) {
      await page.evaluate(() => {
        document.querySelector<HTMLTextAreaElement>(
          '[data-testid="input-textarea"]',
        )!.scrollTop = 0
      })
      await settle(page)
      await expect(visibleDetails(page)).toHaveCount(0)
      await expect(panel(page)).toBeHidden()
      return
    }
    await expect(
      page.getByRole('region', { name: '도와줘서', exact: true }),
    ).toBeVisible()
    await closeLearning(page)
    expect(await editor(page)).toMatchObject({
      same: true,
      focused: true,
      caret,
      scroll,
    })
  })

test('source grammar tap survives the keyboard opening on focus @learning', async ({
  page,
}) => {
  test.skip(await isDesktop(page), 'no software keyboard on the desktop')
  await page.addInitScript(installFakeVisualViewport)
  await page.reload({ waitUntil: 'networkidle' })
  await readingResult(page)
  await page.evaluate(() => {
    document.querySelector('[data-testid="input-textarea"]')!.addEventListener(
      'focus',
      () =>
        (
          window as unknown as {
            __keyboard: { set: (h: number, top: number) => void }
          }
        ).__keyboard.set(Math.floor(window.innerHeight * 0.5), 0),
      { once: true },
    )
  })
  await source(page).click({ position: await grammarPosition(page) })
  const { caret } = await editor(page)
  await expect(
    page.getByRole('region', { name: '도와줘서', exact: true }),
  ).toBeVisible()
  await closeLearning(page)
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    caret,
  })
})

test('dragging from a source grammar underline selects native editor text @learning', async ({
  page,
}) => {
  await readingResult(page)
  const start = await grammarPosition(page)
  const box = (await source(page).boundingBox())!
  const x = box.x + start.x
  const y = box.y + start.y
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 50, y, { steps: 5 })
  await page.mouse.up()
  await settle(page)
  const after = await editor(page)
  expect(after.caret[1]).toBeGreaterThan(after.caret[0])
  expect(after.same).toBe(true)
  await expect(visibleDetails(page)).toHaveCount(0)
  await expect(panel(page)).toBeHidden()
})

test('source grammar is visible before selecting a phrase and never changes editing @learning', async ({
  page,
}) => {
  const input = await readingResult(page)
  await expect(page.getByTestId('source-grammar')).toHaveText([
    '줘서',
    '고마워요',
  ])
  expect(await mirrorText(page)).toBe(input)
  const styles = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="source-highlight"]')!
    return {
      pointer: getComputedStyle(m).pointerEvents,
      line: getComputedStyle(m.querySelector('[data-testid="source-grammar"]')!)
        .textDecorationLine,
    }
  })
  expect(styles).toEqual({ pointer: 'none', line: 'underline' })
  // Typing straight after a tap cancels it and edits as usual.
  await source(page).click({ position: await grammarPosition(page) })
  const { caret } = await editor(page)
  await page.keyboard.type('x')
  await settle(page)
  await expect(visibleDetails(page)).toHaveCount(0)
  await expect(panel(page)).toBeHidden()
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    value: input.slice(0, caret[0]) + 'x' + input.slice(caret[1]),
    caret: [caret[0] + 1, caret[0] + 1],
  })
  await expect(mirror(page)).toHaveCount(0)
  // A selection made in the editor stays.
  await page.evaluate(() =>
    document
      .querySelector<HTMLTextAreaElement>('[data-testid="input-textarea"]')!
      .setSelectionRange(3, 7),
  )
  expect((await editor(page)).caret).toEqual([3, 7])
})

test('source grammar tap after emoji opens its phrase @learning', async ({
  page,
}) => {
  await readKorean(
    page,
    'learn-unicode',
    '정말 고마워요! 👨‍👩‍👧 가족이랑 같이 봤어요.',
  )
  await source(page).blur()
  await markSource(page)
  await expect(page.getByTestId('source-grammar')).toHaveText([
    '고마워요',
    '이랑',
    '봤어요',
  ])
  await source(page).click({ position: await grammarPosition(page, 2) })
  await expect(
    page.getByRole('region', { name: '가족이랑 같이 봤어요', exact: true }),
  ).toBeVisible()
  await closeLearning(page)
  expect(await editor(page)).toMatchObject({ same: true, focused: true })
})

test('keyboard Enter opens mobile learning from the main text @learning', async ({
  page,
}) => {
  test.skip(await isDesktop(page), 'the desktop main text is not a button')
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  const main = mainTranslation(page)
  await expect(main).toHaveAttribute('role', 'button')
  for (const key of ['Enter', ' ']) {
    await main.focus()
    await page.keyboard.press(key)
    await expect(panel(page)).toBeVisible()
    await expect(main).toHaveAttribute('aria-expanded', 'true')
    await closeLearning(page)
    await expect(main).toBeFocused()
    await expect(main).toHaveAttribute('aria-expanded', 'false')
  }
})

test('the word-details trigger ignores a drag and a long press @learning @word', async ({
  page,
}) => {
  await fillSource(
    page,
    `thanks ${fixture('word').match}${nonce().slice(0, 5)}`,
  )
  await waitForDone(page)
  const trigger = page.getByTestId('word-details-trigger')
  await expect(trigger).toBeEnabled()
  // The drag and long press must reach the trigger, not the overlay of the
  // completion View Transition.
  await transitionsDone(page)
  const box = (await trigger.boundingBox())!
  const x = box.x + 4
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 30, y, { steps: 5 })
  await page.mouse.up()
  await trigger.click({ delay: 600 })
  await settle(page)
  await expect(panel(page)).toBeHidden()
  await expect(
    page.locator('.reference-panel[data-word-active="true"]'),
  ).toHaveCount(0)
  await expect(page.locator('.reference-heading:focus')).toHaveCount(0)
  // A short stationary tap still opens the details.
  await trigger.click()
  if (await isDesktop(page))
    await expect(page.locator('.reference-heading')).toBeFocused()
  else await expect(panel(page)).toBeVisible()
})

/** Client centre of the character at `index` of `needle` in the main text. */
async function mainCharPoint(page: Page, needle: string, index = 0) {
  await transitionsDone(page)
  return page.evaluate(
    ([text, offset]) => {
      const main = document.querySelector('[data-testid="main-translation"]')!
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.indexOf(text)
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at + offset)
        range.setEnd(node, at + offset + 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      throw new Error(`main text has no ${text}`)
    },
    [needle, index] as const,
  )
}

test('desktop grammar hit targets stay sparse after a phrase is selected @learning', async ({
  page,
}) => {
  test.skip(!(await isDesktop(page)), 'desktop sparse hit targets')
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  await expect.poll(() => inspectables(page)).toEqual(['지내요'])
  await mainTranslation(page).getByTestId('inspectable-phrase').click()
  await expect(page.getByTestId('selected-phrase')).toHaveText('어떻게 지내요')
  // 오늘 has no grammar highlight: a tap there is plain text.
  const today = await mainCharPoint(page, '오늘')
  await page.mouse.click(today.x, today.y)
  await settle(page)
  await expect(page.getByTestId('selected-phrase')).toHaveText('어떻게 지내요')
  await expect(rows(page).nth(0)).toHaveAttribute('aria-expanded', 'false')
  await expect(rows(page).nth(1)).toHaveAttribute('aria-expanded', 'true')
  // The grammar highlight inside the selected mark still inspects: after
  // the row collapses (no mark, learning open), a tap there selects again.
  const inside = await mainCharPoint(page, '지내요', 1)
  await page.mouse.click(inside.x, inside.y)
  await settle(page)
  await expect(page.getByTestId('selected-phrase')).toHaveText('어떻게 지내요')
  await rows(page).nth(1).click()
  await expect(page.getByTestId('selected-phrase')).toHaveCount(0)
  await page.mouse.click(inside.x, inside.y)
  await expect(page.getByTestId('selected-phrase')).toHaveText('어떻게 지내요')
})

test('touch taps inspect the main text and source grammar @learning', async ({
  page,
}) => {
  test.skip(await isDesktop(page), 'touch layouts')
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  await expect.poll(() => inspectables(page)).toEqual(['지내요'])
  await transitionsDone(page)
  await mainTranslation(page).getByTestId('inspectable-phrase').tap()
  await expect(panel(page)).toBeVisible()
  await expect(page.getByTestId('selected-phrase')).toHaveText('어떻게 지내요')
  await closeLearning(page)
  await readingResult(page)
  await source(page).tap({ position: await grammarPosition(page) })
  await expect(
    page.getByRole('region', { name: '도와줘서', exact: true }),
  ).toBeVisible()
  await closeLearning(page)
  expect(await editor(page)).toMatchObject({ same: true, focused: true })
})

test('mobile translation taps after an emoji map through counterpart quotations to the source phrase @learning', async ({
  page,
}) => {
  test.skip(
    await isDesktop(page),
    'the desktop translation is plain when learning the source',
  )
  await readKorean(
    page,
    'learn-unicode',
    '정말 고마워요! 👨‍👩‍👧 가족이랑 같이 봤어요.',
  )
  await expect(mainTranslation(page)).toHaveAttribute('role', 'button')
  // `I` of "I watched…", right after the family emoji (8 UTF-16 units, 5
  // code points): a miscount lands on the emoji, which has no phrase.
  for (const [needle, phrase] of [
    ['I watched', '가족이랑 같이 봤어요'],
    ['Thank you', '정말 고마워요'],
  ] as const) {
    const at = await mainCharPoint(page, needle)
    await page.mouse.click(at.x, at.y)
    await expect(panel(page)).toBeVisible()
    await expect(
      page.getByRole('region', { name: phrase, exact: true }),
    ).toBeVisible()
    await closeLearning(page)
  }
})

// The mobile learning surface (LearningPanel.tsx): a full-size reading view
// with Close/Escape over the original Copy/Listen dock. The background is
// inert, the reference pane hidden, and closing restores focus.

const BACKGROUND = ['.input-panel', '.target-toolbar', '.result-scroll']

async function backgroundInert(page: Page): Promise<boolean[]> {
  return page.evaluate(
    (selectors) =>
      selectors.map((s) => (document.querySelector(s) as HTMLElement).inert),
    BACKGROUND,
  )
}

/** The control lies inside the window (visibleRect in the TS test). */
async function inViewport(page: Page, testid: string) {
  const box = await page.evaluate((id) => {
    const el =
      document.querySelector(
        `[data-testid="output-toolbar"] [data-testid="${id}"]`,
      ) ?? document.querySelector(`[data-testid="${id}"]`)!
    const r = el.getBoundingClientRect()
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: innerWidth,
      height: innerHeight,
    }
  }, testid)
  expect(box.left).toBeGreaterThanOrEqual(-1)
  expect(box.right).toBeLessThanOrEqual(box.width + 1)
  expect(box.top).toBeGreaterThanOrEqual(-1)
  expect(box.bottom).toBeLessThanOrEqual(box.height + 1)
}

test('mobile text opens a full learning view without a Breakdown button @learning', async ({
  page,
}) => {
  test.skip(await isDesktop(page), 'the desktop shows the reference pane')
  await fillSource(page, `How are you doing today ${nonce()}`)
  await waitForDone(page)
  await expect(page.getByTestId('breakdown-button')).toHaveCount(0)
  // Marks the source and action nodes, so later reads can tell they stayed
  // mounted (the app never replaces them).
  const KEPT = [
    '[data-testid="input-textarea"]',
    '[data-testid="output-toolbar"] [data-testid="copy-button"]',
    '[data-testid="output-toolbar"] [data-testid="listen-button"]',
    '[data-testid="paste-input"]',
    '[data-testid="clear-input"]',
  ]
  await page.evaluate((selectors) => {
    for (const s of selectors)
      (document.querySelector(s) as unknown as { __t21: boolean }).__t21 = true
  }, KEPT)
  const kept = () =>
    page.evaluate(
      (selectors) =>
        selectors.map(
          (s) =>
            (document.querySelector(s) as unknown as { __t21?: boolean })
              .__t21 === true,
        ),
      KEPT,
    )
  await openOverview(page)
  const box = (await panel(page).boundingBox())!
  expect(box.height).toBeGreaterThan(
    (await page.evaluate(() => innerHeight)) * 0.75,
  )
  // The same Copy node, visible and usable beneath the surface.
  expect(await kept()).toEqual(KEPT.map(() => true))
  await inViewport(page, 'copy-button')
  await expect(copyButton(page)).toBeEnabled()
  // Close and the rows are its only controls: no minimize, no Breakdown.
  await expect(panel(page).getByRole('button')).toHaveCount(
    1 + (await rows(page).count()),
  )
  // The heading names the selected phrase.
  const heading = panel(page).getByRole('heading', { level: 2 })
  await expect(heading).toHaveText(STRINGS.en.learn)
  await rows(page).nth(1).click()
  await expect(heading).toHaveText(`${STRINGS.en.learn} · 어떻게 지내요`)
  // The inspector reads in the surface; the background is inert, and the
  // reference pane, header and source are out of the way.
  await expect(
    panel(page).locator(
      '.learning-panel-body [data-testid="learning-inspector"]',
    ),
  ).toHaveCount(1)
  expect(await backgroundInert(page)).toEqual([true, true, true])
  await expect(page.locator('.reference-panel')).toBeHidden()
  await expect(page.locator('.app-header')).toBeHidden()
  await expect(source(page)).toBeHidden()
  // The body scrolls on its own.
  expect(
    await panel(page)
      .locator('.learning-panel-body')
      .evaluate((el) => getComputedStyle(el).overflowY),
  ).toMatch(/auto|scroll/)
  // Escape inside the surface closes it, like Close, and focus returns to
  // the main text. (WebKit leaves a tapped row unfocused, and an Escape
  // from the page clears the source in both apps.)
  await rows(page).nth(1).focus()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await expect(mainTranslation(page)).toBeVisible()
  await expect(mainTranslation(page)).toBeFocused()
  expect(await backgroundInert(page)).toEqual([false, false, false])
  await openOverview(page)
  await closeLearning(page)
  await expect(mainTranslation(page)).toBeFocused()
  expect(await kept()).toEqual(KEPT.map(() => true))
})

test('initial phrase details preserve Copy Paste Clear through overview and inspection @learning', async ({
  page,
}) => {
  const input = `How are you doing today ${nonce()}`
  await fillSource(page, input)
  await waitForDone(page)
  await openOverview(page)
  await expect(rows(page).nth(1)).toBeVisible()
  await rows(page).nth(1).click()
  await expect(page.getByTestId('selected-phrase')).toHaveText('어떻게 지내요')
  await expect(mirror(page).locator('mark')).toHaveText('How are you doing')
  await expect(source(page)).toHaveValue(input)
  await inViewport(page, 'copy-button')
  // Copy still copies the main text while learning is open.
  await copyButton(page).click()
  expect(await readClipboard(page)).toBe(DEFAULT_MAIN)
  await closeLearning(page)
  for (const id of ['paste-input', 'clear-input']) {
    await inViewport(page, id)
    const styles = await page.getByTestId(id).evaluate((button) => ({
      height: button.getBoundingClientRect().height,
      label: getComputedStyle(button.querySelector('span')!).display,
      direction: getComputedStyle(button).flexDirection,
    }))
    expect(styles.height).toBeGreaterThanOrEqual(44)
    expect(styles.label).not.toBe('none')
    expect(styles.direction).toBe('row')
  }
  await openOverview(page)
  await expect(rows(page).first()).toBeVisible()
  await closeLearning(page)
  await page.getByTestId('clear-input').click()
  await expect(source(page)).toHaveValue('')
  await expect(source(page)).toBeFocused()
  await expect(page.getByTestId('selected-phrase')).toHaveCount(0)
})

test('closing learning opened from a source underline restores the exact caret @learning', async ({
  page,
}) => {
  test.skip(await isDesktop(page), 'the desktop leaves source focus in place')
  const text = `${Array(40).fill('다른 문장입니다.').join('\n')}\n오늘 도와줘서 고마워요.`
  await readingResult(page, text)
  await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.scrollTop = ta.scrollHeight
  })
  // The mirror follows the scrolled editor before the underline is read.
  const scrolled = (await editor(page)).scroll
  expect(scrolled).toBeGreaterThan(0)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('[data-testid="source-highlight"]')!.scrollTop,
      ),
    )
    .toBe(scrolled)
  const read = () =>
    page.evaluate(() => {
      const ta = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="input-textarea"]',
      )!
      return {
        start: ta.selectionStart,
        end: ta.selectionEnd,
        direction: ta.selectionDirection,
        top: ta.scrollTop,
      }
    })
  await source(page).click({ position: await grammarPosition(page) })
  // The editor state of the tap, before its grace period opens learning.
  const tapped = await read()
  expect(tapped.top).toBeGreaterThan(0)
  await expect(
    page.getByRole('region', { name: '도와줘서', exact: true }),
  ).toBeVisible()
  // A tap leaves a collapsed caret, so the open surface moves the editor
  // state instead: a backward 3–7 selection, while the hidden editor has
  // lost its scroll. Close brings back the state of the tap.
  await page.evaluate(() =>
    document
      .querySelector<HTMLTextAreaElement>('[data-testid="input-textarea"]')!
      .setSelectionRange(3, 7, 'backward'),
  )
  expect(await read()).toMatchObject({
    start: 3,
    end: 7,
    direction: 'backward',
    top: 0,
  })
  await closeLearning(page)
  expect(await read()).toEqual(tapped)
  expect(await editor(page)).toMatchObject({ same: true, focused: true })
  // Opened from the main text, Close returns to the main text.
  await source(page).blur()
  await mainTranslation(page).click({ position: { x: 4, y: 8 } })
  await expect(panel(page)).toBeVisible()
  await closeLearning(page)
  await expect(mainTranslation(page)).toBeFocused()
})

for (const height of [440, 320])
  test(`learning can be deliberately restored at a short ${height}-pixel portrait height @learning`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 382, height })
    await openApp(page)
    await fillSource(page, `How are you doing today ${nonce()}`)
    await waitForDone(page)
    await openOverview(page)
    // No minimize: the surface shows its rows straight away.
    await expect(
      page.getByRole('button', { name: /show learning/i }),
    ).toHaveCount(0)
    await expect(rows(page).nth(1)).toBeVisible()
    await rows(page).nth(1).click()
    await expect(rows(page).nth(1)).toBeVisible()
    await inViewport(page, 'copy-button')
    expect((await panel(page).boundingBox())!.height).toBeGreaterThan(
      height * 0.7,
    )
    await closeLearning(page)
    for (const id of ['copy-button', 'paste-input', 'clear-input'])
      await inViewport(page, id)
  })

test('long results keep primary actions visible through incremental keyboard shrink and pan @learning', async ({
  page,
}) => {
  await page.addInitScript(installFakeVisualViewport)
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(() =>
    document.documentElement.style.setProperty('--safe-area-bottom', '20px'),
  )
  const line = 'Thanks for helping me today.'
  await fillSource(
    page,
    `${Array(8).fill(line).join('\n\n')}\n${fixture('learn-long').match} ${nonce()}`,
  )
  await waitForDone(page)
  await openOverview(page)
  await expect(rows(page).nth(1)).toBeVisible()
  await rows(page).nth(1).click()
  await closeLearning(page)
  await markSource(page)
  await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="input-textarea"]',
    )!
    ta.focus()
    ta.setSelectionRange(2, 8)
  })
  type Keyboard = { __keyboard: { set: (h: number, top: number) => void } }
  const initial = await page.evaluate(() => innerHeight)
  for (const ratio of [0.85, 0.7, 0.55]) {
    await page.evaluate(
      (h) => (window as unknown as Keyboard).__keyboard.set(h, 0),
      Math.floor(initial * ratio),
    )
    await page.evaluate(() => new Promise(requestAnimationFrame))
  }
  const visible = Math.floor(initial * 0.55)
  await page.evaluate(
    (h) => (window as unknown as Keyboard).__keyboard.set(h, 12),
    visible,
  )
  await expect(page.locator('.app-shell')).toHaveAttribute('data-keyboard')
  for (const control of [
    copyButton(page),
    page.getByTestId('paste-input'),
    page.getByTestId('clear-input'),
  ])
    await expect
      .poll(async () => {
        const r = (await control.boundingBox())!
        return [r.y >= 12 - 1, r.y + r.height <= visible + 12 + 1]
      })
      .toEqual([true, true])
  expect(await editor(page)).toMatchObject({
    same: true,
    focused: true,
    caret: [2, 8],
  })
  await expect(panel(page)).toBeHidden()
})

test('context and learner details remain usable without a popup @learning @word', async ({
  page,
}) => {
  // The context field before the source, so no context edit re-runs a
  // result while its trigger is tapped (the TS test's result never re-runs).
  await page.getByTestId('context-toggle').click()
  await page
    .getByTestId('context-textarea')
    .fill('A friendly colleague helped with a deadline.')
  await expect(page.getByTestId('context-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await page.getByTestId('context-clear').click()
  await expect(page.getByTestId('context-textarea')).toHaveValue('')
  await page.getByTestId('context-toggle').click()
  await fillSource(page, '[fx:word] thanks')
  await waitForDone(page)
  await page.getByTestId('word-details-trigger').click()
  // The pointer tap waits out the selection grace period before opening.
  await expect(page.getByTestId('learning-inspector')).toBeVisible()
  await expect(
    page.getByText(fixture('word').result.grammar as string, { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Learning tips', exact: true }),
  ).toHaveCount(0)
})
