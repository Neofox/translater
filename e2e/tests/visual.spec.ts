// TS-vs-Go visual parity (@visual). Run through `npm run e2e:visual`: the
// TS production build writes the baselines (--update-snapshots=all), then
// the Go app must match them. Baselines live under
// test-results/visual-baseline/<project>/ (playwright.config.ts), so both
// apps share them and nothing is committed.
import type { Page } from '@playwright/test'
import { expect, test } from './helpers'
import { STATES } from '../visual/states'
import { domSnapshot } from '../visual/dom'
import { APP } from '../ports'

// Known Go-vs-TS differences, each owned by a later task and scoped to the
// TS-only elements: the TS baseline run removes `tsHide` before capturing,
// so the pixels, ARIA and DOM baselines lack exactly those elements and
// everything else is compared strictly. They are removed, not hidden,
// because base.css selects on presence (e.g. .app-settings:has(.adjust-menu)).
// The Go run checks that nothing visible matches `tsHide`: once the owning
// task renders the element, the gap entry must go. Never list a difference
// without its owner.
type Gap = { reason: string; tsHide: string; projects?: RegExp }
const ADJUST: Gap = {
  reason: 'Task 26: Adjust disclosure in the header',
  tsHide: '.adjust-menu',
}
const GO_GAPS: Record<string, Gap[]> = {
  'sentence-done': [ADJUST],
  'error-provider': [ADJUST],
  'streaming-skeleton': [ADJUST],
  'listen-loading': [ADJUST],
  'listen-playing': [ADJUST],
  'listen-error': [ADJUST],
  'learning-reference': [ADJUST],
  'learning-source-underlines': [ADJUST],
}

// Pixels that may differ per screenshot. Both apps render on the same
// machine with the same fonts, so identical markup and CSS give identical
// pixels; a ratio (0.001 = 221 px on a phone) let a missing label pass.
const MAX_DIFF_PIXELS = 0

// The scroll containers (result and reference panes).
const SCROLLERS = '.result-scroll, .reference-scroll'

// Pretendard loads from a CDN with `font-display: optional`, so whether it
// renders depends on timing. Both apps render the system-font fallback.
const WEB_FONTS = /^https:\/\/cdn\.jsdelivr\.net\//

/** Fonts ready, two frames painted and no finite animation or transition
 * still running. Infinite ones (.animate-pulse skeletons and the streaming
 * cursor) never finish; the screenshot masks them instead. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' &&
                a.effect?.getTiming().iterations !== Infinity,
            ).length,
      ),
    )
    .toBe(0)
}

for (const state of STATES) {
  test(`${state.name} @visual`, async ({ page, fake }, testInfo) => {
    test.skip(
      Boolean(state.projects) && !state.projects!.test(testInfo.project.name),
      `${state.name} does not apply to ${testInfo.project.name}`,
    )
    await page.route(WEB_FONTS, (route) => route.abort())
    await state.setup(page, fake)
    await settle(page)
    const gaps = (GO_GAPS[state.name] ?? []).filter(
      (gap) => !gap.projects || gap.projects.test(testInfo.project.name),
    )
    for (const gap of gaps) {
      if (APP === 'ts') {
        const removed = await page.evaluate(
          (selector) =>
            [...document.querySelectorAll(selector)].map((e) => e.remove()).length,
          gap.tsHide,
        )
        expect(removed, `TS renders ${gap.tsHide} (${gap.reason})`).toBeGreaterThan(0)
      } else {
        await expect(
          page.locator(gap.tsHide).filter({ visible: true }),
          `Go renders ${gap.tsHide} now: remove its GO_GAPS entry (${gap.reason})`,
        ).toHaveCount(0)
      }
    }
    if (APP === 'ts' && gaps.length > 0) await settle(page)
    // Soft, so one run reports the pixel, ARIA and DOM diffs together.
    // An absolute pixel budget: a ratio allowed a missing label to pass.
    await expect.soft(page).toHaveScreenshot(`${state.name}.png`, {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      mask: [page.locator('.animate-pulse, .result-cursor')],
      threshold: 0.1,
      maxDiffPixels: MAX_DIFF_PIXELS,
    })
    // The page itself never scrolls (fixed app shell), so content below the
    // fold lives in the scroll containers: capture each scrolled to its end.
    const scrollers = page.locator(SCROLLERS).filter({ visible: true })
    for (let i = 0; i < (await scrollers.count()); i++) {
      const scroller = scrollers.nth(i)
      await scroller.evaluate((e) => e.scrollTo({ top: e.scrollHeight }))
      await expect
        .soft(scroller)
        .toHaveScreenshot(`${state.name}-scroll-${i}.png`, {
          animations: 'disabled',
          caret: 'hide',
          mask: [page.locator('.animate-pulse, .result-cursor')],
          threshold: 0.1,
          maxDiffPixels: MAX_DIFF_PIXELS,
        })
      await scroller.evaluate((e) => e.scrollTo({ top: 0 }))
    }
    await expect.soft(page.locator('body')).toMatchAriaSnapshot({
      name: `${state.name}.aria.yml`,
    })
    // toMatchAriaSnapshot matches the baseline as a template, so extra nodes
    // pass (children 'contain'; 'deep-equal' cannot work because the stored
    // template drops text already in a node's name). The whole tree must
    // also be identical, so an element only Go renders fails too.
    expect
      .soft(await page.locator('body').ariaSnapshot())
      .toMatchSnapshot(`${state.name}.aria-tree.txt`)
    // Markup the ARIA tree does not show: class strings, test ids, lang and
    // aria-* attributes and element structure (e2e/visual/dom.ts).
    expect(await domSnapshot(page)).toMatchSnapshot(`${state.name}-dom.txt`)
  })
}
