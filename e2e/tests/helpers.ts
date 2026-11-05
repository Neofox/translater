import { readFileSync } from 'node:fs'
import { test as base, expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'
import strings from '../../shared/translation/i18n/strings.json' with { type: 'json' }
import { WORKERS, appUrl, fakeUrl } from '../ports'

export { expect }

export type UiLang = 'en' | 'ko'
export type StringKey = keyof (typeof strings)['en']
export const STRINGS: Record<UiLang, Record<StringKey, string>> = strings

export type Stats = {
  requests: number
  aborted: number
  /** Requests (translation and speech) the fake is still serving; /_reset
   * keeps it. */
  active: number
  lastBodies: string[]
  /** POST /v1/audio/speech requests, counted apart from translations. */
  speechRequests: number
  speechAborted: number
  lastSpeechBodies: string[]
}

/** Client for this worker's fake OpenAI server. */
export class Fake {
  constructor(readonly url: string) {}

  async reset(): Promise<void> {
    const res = await fetch(`${this.url}/_reset`, { method: 'POST' })
    if (!res.ok) throw new Error(`fake reset failed: ${res.status}`)
  }

  async stats(): Promise<Stats> {
    const res = await fetch(`${this.url}/_stats`)
    return (await res.json()) as Stats
  }

  async requests(): Promise<number> {
    return (await this.stats()).requests
  }

  async aborted(): Promise<number> {
    return (await this.stats()).aborted
  }

  /** Parsed request bodies the fake kept (the last five), oldest first. */
  async bodies(): Promise<Array<Record<string, unknown>>> {
    const { lastBodies } = await this.stats()
    return lastBodies.map((body) => JSON.parse(body) as Record<string, unknown>)
  }

  /** Parsed speech request bodies (the last five), oldest first. */
  async speechBodies(): Promise<Array<Record<string, unknown>>> {
    const { lastSpeechBodies } = await this.stats()
    return lastSpeechBodies.map(
      (body) => JSON.parse(body) as Record<string, unknown>,
    )
  }
}

/** This worker's fake + app pair (see ports.ts). */
function pairIndex(testInfo: TestInfo): number {
  const index = testInfo.parallelIndex
  if (index >= WORKERS)
    throw new Error(
      `Playwright worker ${index} has no fake/app pair: only ${WORKERS} were ` +
        'started. Set E2E_WORKERS instead of --workers.',
    )
  return index
}

const SETTLE_MS = 5_000

// Playwright fixtures must destructure their dependencies, even when empty.
/* eslint-disable no-empty-pattern */
export const test = base.extend<{ fake: Fake }>({
  baseURL: async ({}, use, testInfo) => {
    await use(appUrl(pairIndex(testInfo)))
  },
  fake: async ({}, use, testInfo) => {
    const fake = new Fake(fakeUrl(pairIndex(testInfo)))
    // A previous test's page may have closed mid-stream. Wait until the
    // fake has finished (and counted the abort of) every request, so nothing
    // lands after the reset.
    const start = Date.now()
    let stats = await fake.stats()
    while (stats.active > 0) {
      if (Date.now() - start > SETTLE_MS)
        throw new Error(
          `fake upstream still serves ${stats.active} request(s) ${SETTLE_MS}ms ` +
            'after the previous test: the app did not cancel or finish them.',
        )
      await new Promise((resolve) => setTimeout(resolve, 25))
      stats = await fake.stats()
    }
    await fake.reset()
    await use(fake)
  },
})
/* eslint-enable no-empty-pattern */

type Fixture = {
  match: string
  result: Record<string, unknown> & {
    main?: string
    rationale?: string
    primaryTranslation?: string
    alternatives?: Array<{ text: string; note: string }>
  }
}

export function fixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/results/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Fixture
}

/** Unique Latin suffix: keeps every input out of the app's server-side LRU
 * (shared by all projects on a worker) without ending in punctuation. */
export function nonce(): string {
  return `n${Math.random().toString(36).slice(2, 10)}`
}

/** English sentence that selects `name`'s fixture and is unique per call. */
export function sentence(name: string): string {
  return `How are you doing today my friend ${fixture(name).match} ${nonce()}`
}

export async function openApp(page: Page): Promise<void> {
  // Wait for the client modules, so typing starts from a fully wired page
  // (early-typing.spec.ts covers text typed before they run).
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(source(page)).toBeVisible()
}

export function source(page: Page): Locator {
  return page.getByTestId('input-textarea')
}

/** Replace the source text in one input event. */
export async function fillSource(page: Page, text: string): Promise<void> {
  await source(page).fill(text)
  await expect(source(page)).toHaveValue(text)
}

/** Type the source text key by key at the end of the current value. */
export async function typeSource(page: Page, text: string): Promise<void> {
  await source(page).click()
  await page.keyboard.type(text)
}

export function mainTranslation(page: Page): Locator {
  return page.getByTestId('main-translation').first()
}

export async function mainText(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.querySelector('[data-testid="main-translation"]')?.textContent ??
      null,
  )
}

export function copyButton(page: Page): Locator {
  return page.getByTestId('output-toolbar').getByTestId('copy-button')
}

export function listenButton(page: Page): Locator {
  return page.getByTestId('output-toolbar').getByTestId('listen-button')
}

export function translationResult(page: Page): Locator {
  return page.getByTestId('translation-result')
}

/** The whole result has completed: main Listen only enables then. */
export async function waitForDone(page: Page, timeout = 20_000): Promise<void> {
  await expect(listenButton(page)).toBeEnabled({ timeout })
}

export async function waitForMain(page: Page, main: string): Promise<void> {
  await expect.poll(() => mainText(page), { timeout: 20_000 }).toBe(main)
}

/** Poll the fake until `predicate` holds; returns the elapsed milliseconds. */
export async function waitForStats(
  fake: Fake,
  predicate: (stats: Stats) => boolean,
  timeout = 10_000,
): Promise<number> {
  const start = Date.now()
  for (;;) {
    const stats = await fake.stats()
    if (predicate(stats)) return Date.now() - start
    if (Date.now() - start > timeout)
      throw new Error(
        `fake stats never matched: ${JSON.stringify({ ...stats, lastBodies: stats.lastBodies.length, lastSpeechBodies: stats.lastSpeechBodies.length })}`,
      )
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** Last text part of the last user message in a Responses request body. */
export function userText(body: Record<string, unknown>): string {
  const input = body.input as Array<{ role: string; content: unknown }>
  const user = input.filter((m) => m.role === 'user').at(-1)
  if (!user) return ''
  if (typeof user.content === 'string') return user.content
  const parts = user.content as Array<{ text?: string }>
  return parts.map((p) => p.text ?? '').join('\n')
}

export function bodyText(body: Record<string, unknown>): string {
  return JSON.stringify(body)
}

// ----- Header controls ------------------------------------------------------

export async function setUiLang(page: Page, lang: UiLang): Promise<void> {
  const settings = page.getByTestId('settings-button')
  await settings.click()
  const group = page.getByRole('group', { name: 'UI language' })
  await group.getByRole('button', { name: lang === 'ko' ? '한' : 'EN' }).click()
  await expect(
    group.getByRole('button', { name: lang === 'ko' ? '한' : 'EN' }),
  ).toHaveAttribute('aria-pressed', 'true')
  // Toggle closed.
  await settings.click()
  await expect(group).toBeHidden()
}

export async function uiLangPressed(page: Page, lang: UiLang): Promise<void> {
  const settings = page.getByTestId('settings-button')
  await settings.click()
  const group = page.getByRole('group', { name: 'UI language' })
  await expect(
    group.getByRole('button', { name: lang === 'ko' ? '한' : 'EN' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await settings.click()
  await expect(group).toBeHidden()
}

type Mode = 'friends' | 'casual' | 'professional'
const MODE_KEY = {
  friends: 'modeFriends',
  casual: 'modeCasual',
  professional: 'modeProfessional',
} as const satisfies Record<Mode, StringKey>

/** Tone is a button group on wide headers and a select on narrow ones. */
export async function setTone(page: Page, mode: Mode, ui: UiLang = 'en') {
  const name = STRINGS[ui].tone
  const group = page.getByRole('group', { name, exact: true })
  if (await group.isVisible()) {
    await group
      .getByRole('button', { name: STRINGS[ui][MODE_KEY[mode]], exact: true })
      .click()
  } else {
    await page.getByRole('combobox', { name, exact: true }).selectOption(mode)
  }
}

export async function expectTone(page: Page, mode: Mode, ui: UiLang = 'en') {
  const name = STRINGS[ui].tone
  const group = page.getByRole('group', { name, exact: true })
  if (await group.isVisible()) {
    await expect(
      group.getByRole('button', {
        name: STRINGS[ui][MODE_KEY[mode]],
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true')
  } else {
    await expect(page.getByRole('combobox', { name, exact: true })).toHaveValue(
      mode,
    )
  }
}

type Bar = 'source' | 'target'

export function languageBar(page: Page, bar: Bar, ui: UiLang = 'en'): Locator {
  return page.getByRole('group', {
    name: STRINGS[ui][bar === 'source' ? 'sourceLanguage' : 'targetLanguage'],
    exact: true,
  })
}

export function languageChip(
  page: Page,
  bar: Bar,
  code: string,
  ui: UiLang = 'en',
): Locator {
  return languageBar(page, bar, ui).locator(
    `[data-testid="lang-chip"][data-value="${code}"]`,
  )
}

/** Click the chip when the bar shows it; narrow bars hide inactive chips, so
 * fall back to the More… listbox. */
export async function pickLanguage(
  page: Page,
  bar: Bar,
  code: string,
  ui: UiLang = 'en',
): Promise<void> {
  const chip = languageChip(page, bar, code, ui)
  if ((await chip.count()) > 0 && (await chip.isVisible())) {
    await chip.click()
  } else {
    await pickFromMore(page, bar, code, ui)
  }
  await expect(languageChip(page, bar, code, ui)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
}

export async function pickFromMore(
  page: Page,
  bar: Bar,
  code: string,
  ui: UiLang = 'en',
): Promise<void> {
  await languageBar(page, bar, ui).getByTestId('lang-more-trigger').click()
  await page
    .locator(`[data-testid="select-option"][data-value="${code}"]`)
    .click()
}

export async function expectLanguage(
  page: Page,
  bar: Bar,
  code: string,
  ui: UiLang = 'en',
): Promise<void> {
  await expect(languageChip(page, bar, code, ui)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
}

// ----- Clipboard --------------------------------------------------------------

export async function writeClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text)
}

export async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

/** Record every distinct main-translation text, with the number of
 * alternatives and Copy state at that moment. */
export async function recordResult(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Entry = { text: string | null; alternatives: number; copy: boolean }
    const log: Entry[] = []
    ;(window as unknown as { __resultLog: Entry[] }).__resultLog = log
    const snapshot = () => {
      const text =
        document.querySelector('[data-testid="main-translation"]')
          ?.textContent ?? null
      const alternatives = document.querySelectorAll(
        '[data-testid="alternative-item"]',
      ).length
      const copy = !document.querySelector<HTMLButtonElement>(
        '[data-testid="output-toolbar"] [data-testid="copy-button"]',
      )?.disabled
      const last = log.at(-1)
      if (
        !last ||
        last.text !== text ||
        last.alternatives !== alternatives ||
        last.copy !== copy
      )
        log.push({ text, alternatives, copy })
    }
    snapshot()
    new MutationObserver(snapshot).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled'],
    })
  })
}

export async function resultLog(
  page: Page,
): Promise<
  Array<{ text: string | null; alternatives: number; copy: boolean }>
> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __resultLog: Array<{
            text: string | null
            alternatives: number
            copy: boolean
          }>
        }
      ).__resultLog,
  )
}
