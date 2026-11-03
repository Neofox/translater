// Word results (@word): WordView.tsx alternatives with register tags, the
// word-details trigger as main text, and the dictionary (WordSourceMeta.tsx,
// CharacterNotes.tsx) in the reference pane of workspace/split/book layouts.
// Compact layouts show the dictionary only in the learning surface (Task
// 17), so the dictionary tests skip there until it exists.
import type { Page } from '@playwright/test'
import {
  STRINGS,
  expect,
  fillSource,
  fixture,
  mainTranslation,
  nonce,
  openApp,
  source,
  test,
  waitForDone,
  waitForMain,
} from './helpers'

/** A word input selecting `name`'s fixture: `head`, then the marker with a
 * nonce glued on (two tokens, ≤ 24 chars, so detectIntent says word). */
function wordInput(name: string, head: string): string {
  return `${head} ${fixture(name).match}${nonce().slice(0, 5)}`
}

const meta = (page: Page) => page.locator('.reference-panel .word-source-meta')

/** The layout shows the reference pane (ReferencePanel.tsx). */
async function separateReference(page: Page): Promise<boolean> {
  const layout = await page.locator('.translator-panels').getAttribute('data-layout')
  return ['workspace', 'split', 'book'].includes(layout ?? '')
}

async function skipWithoutReference(page: Page): Promise<void> {
  test.skip(
    !(await separateReference(page)),
    'the dictionary is in the learning surface (Task 17) in compact layouts',
  )
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('word result shows primary translation, register tags and alternatives @word', async ({ page }) => {
  const fx = fixture('word')
  await fillSource(page, wordInput('word', 'thanks'))
  await waitForMain(page, fx.result.primaryTranslation!)
  await waitForDone(page)
  const trigger = mainTranslation(page).getByTestId('word-details-trigger')
  await expect(trigger).toHaveText(fx.result.primaryTranslation!)
  await expect(trigger).toHaveAttribute(
    'aria-label',
    `${STRINGS.en.wordDetails}: ${fx.result.primaryTranslation}`,
  )
  await expect(trigger).toBeEnabled()
  const items = page.getByTestId('alternative-item')
  await expect(items).toHaveCount(3)
  await expect(items.first().locator('.flex.flex-wrap.items-baseline.gap-2')).toContainText('casual polite')
  await expect(items.nth(1).locator('span.uppercase')).toHaveText(['very casual', 'emphatic'])
  await expect(page.locator('.detail-alternatives .result-section-title')).toHaveText(
    STRINGS.en.alternativeTranslations,
  )
})

test('dictionary streams POS, meanings and synonyms @word', async ({ page }) => {
  await skipWithoutReference(page)
  await fillSource(page, wordInput('word', 'thanks'))
  await waitForDone(page)
  const dictionary = meta(page)
  await expect(dictionary).toBeVisible()
  // Go keeps the other POS tabs' blocks mounted but hidden.
  const shown = (text: string) =>
    dictionary.getByText(text, { exact: true }).filter({ visible: true })
  await expect(
    dictionary.locator('.dictionary-label').filter({ visible: true }),
  ).toHaveText(
    (['pos', 'primaryMeaning', 'otherMeanings', 'etymology', 'grammar', 'notes', 'synonyms'] as const).map(
      (key) => STRINGS.en[key],
    ),
  )
  await expect(dictionary.locator('.animate-pulse')).toHaveCount(0)
  const posLabel = dictionary.locator('span.italic').filter({ visible: true })
  await expect(posLabel).toHaveText('interjection')
  await expect(shown('A short, informal expression of gratitude.')).toBeVisible()
  await dictionary.getByRole('button', { name: 'noun', exact: true }).click()
  await expect(posLabel).toHaveText('noun')
  await expect(shown('An expression or feeling of gratitude.')).toBeVisible()
  await expect(
    dictionary.locator('li').filter({ visible: true, hasText: '(interjection)' }),
  ).toContainText('A short, informal expression of gratitude.')
})

test('dictionary shows the next pending section while streaming @word', async ({ page }) => {
  await skipWithoutReference(page)
  const fx = fixture('word-slow')
  await fillSource(page, wordInput('word-slow', 'ty'))
  await waitForMain(page, fx.result.primaryTranslation!)
  await expect(page.getByTestId('word-details-trigger')).toBeDisabled()
  // Exactly one skeleton: the first section still pending.
  await expect(meta(page)).toBeVisible()
  await expect(meta(page).locator('.animate-pulse')).toHaveCount(1)
  // Stop the slow stream.
  await page.getByTestId('clear-input').click()
})

test('a word run stopped before any dictionary entry renders no dictionary @word', async ({ page, fake }) => {
  await skipWithoutReference(page)
  const fx = fixture('word-slow')
  await fillSource(page, wordInput('word-slow', 'ty'))
  await waitForMain(page, fx.result.primaryTranslation!)
  // Streaming, and no POS entry has closed yet: only the skeleton.
  await expect(meta(page).locator('.animate-pulse')).toHaveCount(1)
  await expect(meta(page).locator('span.italic')).toHaveCount(0)
  // An edit aborts the run; the pane stays during the debounce, without
  // an empty dictionary block (WordSourceMeta returns null).
  await source(page).press('End')
  await source(page).press('z')
  await expect(page.locator('.word-source-meta')).toHaveCount(0)
  expect(await fake.requests()).toBe(1)
})

test('the chosen POS tab survives later dictionary updates @word', async ({ page }) => {
  await skipWithoutReference(page)
  await fillSource(page, wordInput('word-slow', 'ty'))
  // Tabs appear once a second POS entry has closed; etymology and the
  // other fields still stream after it.
  await meta(page).getByRole('button', { name: 'noun', exact: true }).click()
  // Still streaming after the click, so later partials provably arrive.
  await expect(meta(page).locator('.animate-pulse')).toHaveCount(1)
  await waitForDone(page)
  await expect(meta(page).locator('.animate-pulse')).toHaveCount(0)
  await expect(meta(page).locator('span.italic').filter({ visible: true })).toHaveText('noun')
  await expect(
    meta(page).getByText('An expression or feeling of gratitude.', { exact: true }).filter({ visible: true }),
  ).toBeVisible()
})

test('synonym starts a new lookup @word', async ({ page }) => {
  await skipWithoutReference(page)
  await fillSource(page, wordInput('word', 'thanks'))
  await waitForDone(page)
  const synonym = (fixture('word').result.synonyms as string[])[0]!
  // The app's own translation request (Go: form fields, TS: server
  // function JSON), whatever the server cache holds. Warm-ups never carry
  // the text.
  const encodings = [synonym, synonym.replaceAll(' ', '+'), encodeURIComponent(synonym)]
  const lookup = page.waitForRequest(
    (r) => r.method() === 'POST' && encodings.some((s) => (r.postData() ?? '').includes(s)),
  )
  const clicked = Date.now()
  await meta(page).getByRole('button', { name: synonym, exact: true }).click()
  await expect(source(page)).toHaveValue(synonym)
  await expect(source(page)).toBeFocused()
  await lookup
  // Debounced like typing (800 ms), not immediate like Paste.
  expect(Date.now() - clicked).toBeGreaterThanOrEqual(300)
})

test('only real character origins are shown @word', async ({ page }) => {
  await skipWithoutReference(page)
  await fillSource(page, wordInput('word-hanja', '학교'))
  await waitForDone(page)
  const notes = meta(page).locator('.character-notes')
  await expect(notes.locator('.dictionary-label')).toHaveText(STRINGS.en.hanja)
  await expect(notes).toContainText('學 (learn) · 校 (school)')
  await expect(notes).not.toContainText('사랑')
})

test('word metadata stays separate from translation actions at every size @word', async ({ page }) => {
  await fillSource(page, wordInput('word', 'thanks'))
  await waitForDone(page)
  const toolbar = page.getByTestId('output-toolbar')
  for (const text of ['interjection', 'noun', 'verb', STRINGS.en.pos])
    await expect(toolbar).not.toContainText(text)
})
