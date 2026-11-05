// Keyboard review evidence (Task 28, step 5): screenshots and a video of
// every documented keyboard behaviour on an iPhone (WebKit) and a Pixel
// (Chromium) profile, for the user to accept or reject after the fact. Not
// a parity test: it only runs with KEYBOARD_REVIEW=1, e.g.
//
//   KEYBOARD_REVIEW=1 APP=go npx playwright test -c e2e keyboard-review \
//     --project webkit-iphone-portrait --project chromium-portrait \
//     --output test-results/keyboard-review
//
// The software keyboard is simulated as in layout.spec.ts (a stubbed
// visualViewport); a grey band labelled "keyboard" is drawn under the
// visible area so the screenshots show what the keyboard covers. Inputs
// are fixed, so the Go and TS captures can be compared byte for byte.
import { devices } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
import {
  expect,
  fillSource,
  openApp,
  source,
  test,
  waitForDone,
} from './helpers'
import { installFakeVisualViewport } from '../perf/page-scripts'
import type { PageGlobals } from '../perf/page-scripts'

test.skip(!process.env.KEYBOARD_REVIEW, 'review evidence: KEYBOARD_REVIEW=1')
test.use({ video: 'on' })

/** Simulated keyboard: the visible height and Safari's pan offset, with the
 * covered area drawn as a band. `pan` changes only the offset (scroll). */
async function keyboard(
  page: Page,
  visible: number | null,
  top = 0,
  panOnly = false,
): Promise<void> {
  await page.evaluate(
    ([h, t, scrollOnly]) => {
      const kb = (window as unknown as PageGlobals).__keyboard!
      if (scrollOnly) kb.pan(t)
      else kb.set(h, t)
      let band = document.getElementById('review-keyboard')
      if (!band) {
        band = document.createElement('div')
        band.id = 'review-keyboard'
        band.textContent = 'keyboard'
        band.style.cssText =
          'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;' +
          'background:#9aa0a6;color:#202124;font:600 14px system-ui;' +
          'display:flex;align-items:center;justify-content:center;' +
          'pointer-events:none;opacity:.92'
        document.body.append(band)
      }
      const covered = h === null ? 0 : Math.max(0, innerHeight - h - t)
      band.style.height = `${covered}px`
      band.hidden = covered === 0
    },
    [visible, top, panOnly] as const,
  )
  await page.evaluate(() => new Promise(requestAnimationFrame))
}

let shot = 0
/** Evidence only: lets a debounced re-run (800 ms) start and finish, then
 * waits for finite animations, so both apps are captured at rest. */
async function capture(page: Page, testInfo: TestInfo, name: string) {
  shot += 1
  await page.waitForTimeout(1000)
  await expect(page.locator('.output-panel')).not.toHaveAttribute(
    'aria-busy',
    'true',
    { timeout: 20_000 },
  )
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
  await page.screenshot({
    path: testInfo.outputPath(`${String(shot).padStart(2, '0')}-${name}.png`),
  })
}

async function review(page: Page, testInfo: TestInfo): Promise<void> {
  shot = 0
  const shell = page.locator('.app-shell')
  await page.addInitScript(installFakeVisualViewport)
  await openApp(page)
  await fillSource(page, '[fx:learn-long] How are you doing today, my friend?')
  await waitForDone(page)
  const { height } = page.viewportSize()!
  await capture(page, testInfo, 'result-keyboard-closed')

  // 1. The keyboard rises in 50 px steps: the shell follows the visible
  // height, the result scrolls back to the main translation on entry.
  await page.getByTestId('translation-result').evaluate((e) => {
    e.scrollTop = 200
  })
  await source(page).evaluate((e: HTMLTextAreaElement) => {
    e.focus({ preventScroll: true })
    e.setSelectionRange(2, 8)
  })
  const roomy = Math.max(400, Math.round(height * 0.55))
  for (let step = height - 50; step > roomy; step -= 50) {
    await keyboard(page, step)
    await page.waitForTimeout(120)
  }
  await keyboard(page, roomy)
  await expect(shell).toHaveAttribute('data-keyboard', 'true')
  await capture(page, testInfo, 'keyboard-open-roomy-header-kept')

  // 2. A tight keyboard (under 360 px visible) hides the header and moves
  // the 47 px top inset onto the shell.
  await shell.evaluate((e) => e.style.setProperty('--safe-area-top', '47px'))
  const tight = Math.min(300, Math.floor(height / 2))
  await keyboard(page, tight)
  await expect(shell).toHaveAttribute('data-tight', 'true')
  await capture(page, testInfo, 'keyboard-tight-header-hidden-inset-on-shell')

  // 3. Safari pans the visual viewport (scroll only): the shell follows.
  await keyboard(page, tight, 40, true)
  await capture(page, testInfo, 'safari-pan-shell-follows')
  await keyboard(page, tight, 0)

  // 4. Typing several lines: at least two editable lines, Paste/Clear
  // sticky above the keyboard.
  await source(page).fill(
    'First line to translate.\nSecond line to edit.\nThird line stays here.\nFourth line.\nFifth line.',
  )
  await capture(page, testInfo, 'multiline-two-lines-sticky-actions')

  // 5. Reply context under the keyboard; Clear empties the turn, keeps the
  // context and gives focus back to the source.
  await page.getByTestId('context-toggle').click()
  await page.getByTestId('context-textarea').fill('A friend is checking in.')
  await capture(page, testInfo, 'reply-context-under-keyboard')
  await page.getByTestId('clear-input').click()
  await capture(page, testInfo, 'clear-keeps-context-focuses-source')

  // 6. The keyboard closes: the full layout returns with the same editor.
  await keyboard(page, null)
  await expect(shell).not.toHaveAttribute('data-keyboard')
  await capture(page, testInfo, 'keyboard-closed-again')

  // 7. A short stacked window (tight, no keyboard) hides the target
  // language row so the main text stays tappable.
  await fillSource(page, 'How are you doing today, my friend?')
  await waitForDone(page)
  const { width } = page.viewportSize()!
  await page.setViewportSize({ width, height: 340 })
  await expect(page.locator('.translator-panels')).toHaveAttribute(
    'data-tight',
    'true',
  )
  await capture(page, testInfo, 'short-window-target-row-hidden')
}

const iphone = { ...devices['iPhone 15'] } as Record<string, unknown>
delete iphone.defaultBrowserType
const pixel = { ...devices['Pixel 7'] } as Record<string, unknown>
delete pixel.defaultBrowserType

test.describe('iPhone (WebKit)', () => {
  test.use(iphone)
  test('keyboard behaviours on an iPhone @review', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'webkit', 'WebKit profile')
    await review(page, testInfo)
  })
})

test.describe('Pixel (Chromium)', () => {
  test.use(pixel)
  test('keyboard behaviours on a Pixel @review', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chromium profile')
    await review(page, testInfo)
  })
})
