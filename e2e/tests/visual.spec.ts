// Visual regression (@visual). `npm run e2e:visual:update` writes the
// baselines from the current checkout; `npm run e2e:visual` compares the app
// with them. Baselines live under test-results/visual-baseline/<project>/
// (playwright.config.ts) and are never committed: they depend on the
// machine's fonts and browser builds.
import type { CDPSession, Page } from '@playwright/test'
import { expect, test } from './helpers'
import { STATES, foldSession } from '../visual/states'
import { domSnapshot } from '../visual/dom'

// Pixels that may differ per screenshot. Baseline and comparison render on
// the same machine with the same fonts, so identical markup and CSS give
// identical pixels; a ratio (0.001 = 221 px on a phone) let a missing label
// pass.
const MAX_DIFF_PIXELS = 0

// The scroll containers (result and reference panes).
const SCROLLERS = '.result-scroll, .reference-scroll'

// Pretendard loads from a CDN with `font-display: optional`, so whether it
// renders depends on timing. Every capture renders the system-font fallback.
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

const CAPTURE = {
  threshold: 0.1,
  maxDiffPixels: MAX_DIFF_PIXELS,
}

/** The folded layout is still in place (data-layout on the shell). */
async function expectFolded(page: Page, mode: string): Promise<void> {
  expect(
    await page.locator('.app-shell').getAttribute('data-layout'),
    `still ${mode} (a silently unfolded capture must fail)`,
  ).toBe(mode)
}

/** A PNG of the viewport, or of `clip`, taken through the CDP session that
 * folded the page: Playwright's screenshots re-apply its device metrics and
 * drop the fold's display feature. The caret is hidden as Playwright's
 * `caret: 'hide'` does; settle() already waited for finite animations. */
async function cdpShot(
  page: Page,
  cdp: CDPSession,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  await page.addStyleTag({
    content: '*{caret-color:transparent!important}',
  })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    ...(clip && { clip: { ...clip, scale: 1 } }),
  })
  return Buffer.from(data, 'base64')
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
    const cdp = state.folded ? foldSession(page) : undefined
    if (state.folded) {
      // Folded states: CDP captures, with the posture checked before and
      // after each one. The page never scrolls (fixed app shell), so the
      // viewport is the full page. Masked skeletons must not be showing.
      expect(cdp, 'fold() keeps its CDP session').toBeDefined()
      await expectFolded(page, state.folded)
      await expect(
        page
          .locator('.animate-pulse, .result-cursor')
          .filter({ visible: true }),
      ).toHaveCount(0)
      expect
        .soft(await cdpShot(page, cdp!))
        .toMatchSnapshot(`${state.name}.png`, CAPTURE)
      await expectFolded(page, state.folded)
    } else {
      // Soft, so one run reports the pixel, ARIA and DOM diffs together.
      // An absolute pixel budget: a ratio allowed a missing label to pass.
      await expect.soft(page).toHaveScreenshot(`${state.name}.png`, {
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        mask: [page.locator('.animate-pulse, .result-cursor')],
        ...CAPTURE,
      })
    }
    // The page itself never scrolls (fixed app shell), so content below the
    // fold lives in the scroll containers: capture each scrolled to its end.
    const scrollers = page.locator(SCROLLERS).filter({ visible: true })
    for (let i = 0; i < (await scrollers.count()); i++) {
      const scroller = scrollers.nth(i)
      await scroller.evaluate((e) => e.scrollTo({ top: e.scrollHeight }))
      if (state.folded) {
        const box = (await scroller.boundingBox())!
        expect
          .soft(await cdpShot(page, cdp!, box))
          .toMatchSnapshot(`${state.name}-scroll-${i}.png`, CAPTURE)
        await expectFolded(page, state.folded)
      } else {
        await expect
          .soft(scroller)
          .toHaveScreenshot(`${state.name}-scroll-${i}.png`, {
            animations: 'disabled',
            caret: 'hide',
            mask: [page.locator('.animate-pulse, .result-cursor')],
            ...CAPTURE,
          })
      }
      await scroller.evaluate((e) => e.scrollTo({ top: 0 }))
    }
    await expect.soft(page.locator('body')).toMatchAriaSnapshot({
      name: `${state.name}.aria.yml`,
    })
    // toMatchAriaSnapshot matches the baseline as a template, so extra nodes
    // pass (children 'contain'; 'deep-equal' cannot work because the stored
    // template drops text already in a node's name). The whole tree must
    // also be identical, so an added element fails too.
    expect
      .soft(await page.locator('body').ariaSnapshot())
      .toMatchSnapshot(`${state.name}.aria-tree.txt`)
    // Markup the ARIA tree does not show: class strings, test ids, lang and
    // aria-* attributes and element structure (e2e/visual/dom.ts).
    expect(await domSnapshot(page)).toMatchSnapshot(`${state.name}-dom.txt`)
    if (state.folded) await expectFolded(page, state.folded)
  })
}
