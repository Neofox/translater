// Learning in the initial response (@learning): LearningInspector.tsx's
// whole-message rows, InspectableTranslation.tsx's grammar phrases and
// selected mark, SourceHighlight.tsx's source mirror. Ports of
// tests/browser/learning.browser.tsx.
//
// The rows show in the reference pane of workspace/split/book layouts once
// the result is done. Compact layouts show them only in the learning surface,
// which opens from a tap on the main text (Task 20/21), so the row parts of
// these tests skip there. Selecting a row opens learning: split and book then
// show the rows in the full-size surface, the desktop workspace keeps them
// beside the source.
import type { Page } from '@playwright/test'
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
  sentence,
  setUiLang,
  source,
  test,
  waitForDone,
  waitForMain,
} from './helpers'

const rows = (page: Page) => page.getByTestId('learning-chunk')
const mirror = (page: Page) => page.getByTestId('source-highlight')

/** The layout shows the reference pane (ReferencePanel.tsx). */
async function separateReference(page: Page): Promise<boolean> {
  const layout = await page
    .locator('.translator-panels')
    .getAttribute('data-layout')
  return ['workspace', 'split', 'book'].includes(layout ?? '')
}

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
  if (await separateReference(page)) {
    const row = rows(page).nth(1)
    await expect(row).toContainText('어떻게 지내요')
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    const detail = page.locator('.phrase-detail').filter({ visible: true })
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
  }
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
  if (!(await separateReference(page))) return
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
  if (!(await separateReference(page))) return
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
  test.skip(
    !(await separateReference(page)),
    'compact layouts show the rows in the learning surface (Task 20/21)',
  )
  await expect(rows(page)).toHaveCount(24)
  await expect(page.locator('.learning-sentences')).toHaveCount(0)
  const visibleDetails = page
    .locator('.phrase-detail')
    .filter({ visible: true })
  await rows(page).nth(4).click()
  await expect(rows(page).nth(4)).toHaveAttribute('aria-expanded', 'true')
  await expect(rows(page)).toHaveCount(24)
  await expect(visibleDetails).toHaveCount(1)
  await expect(
    visibleDetails.getByText('도와주다 emphasizes helping another person.', {
      exact: true,
    }),
  ).toBeVisible()
  await rows(page).nth(7).click()
  await expect(rows(page).nth(7)).toHaveAttribute('aria-expanded', 'true')
  await expect(rows(page).nth(4)).toHaveAttribute('aria-expanded', 'false')
  await expect(visibleDetails).toHaveCount(1)
  await rows(page).nth(7).click()
  await expect(visibleDetails).toHaveCount(0)
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
  if (await separateReference(page)) await expect(rows(page)).toHaveCount(3)
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
  if (!(await separateReference(page))) return
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
  const separate = await separateReference(page)
  const select = async () => {
    await expect.poll(() => inspectables(page)).toEqual(['지내요'])
    if (!separate) return
    await rows(page).nth(1).click()
    await expect(page.getByTestId('selected-phrase')).toHaveText(
      '어떻게 지내요',
    )
    // The counterpart quotation is marked under the source.
    await expect(mirror(page).locator('mark')).toHaveText('How are you doing')
    if (!(await isDesktop(page)))
      await page.getByRole('button', { name: STRINGS.en.closeLearning }).click()
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
  if (await separateReference(page))
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
