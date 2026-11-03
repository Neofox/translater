// TS-vs-Go visual parity (@visual). Run through `npm run e2e:visual`: the
// TS production build writes the baselines (--update-snapshots=all), then
// the Go app must match them. Baselines live under
// test-results/visual-baseline/<project>/ (playwright.config.ts), so both
// apps share them and nothing is committed.
import type { Page } from '@playwright/test'
import { expect, test } from './helpers'
import { STATES } from '../visual/states'
import { APP } from '../ports'

// Known Go-vs-TS differences per state, each owned by a later task. A state
// with gaps in a project is expected to fail on Go there (test.fail, declared
// only once setup has settled, so a broken setup still fails): Playwright
// reports an unexpected pass once every listed gap is closed, so the owning
// task must remove its entry. Never list a difference without its owner.
type Gap = { reason: string; projects?: RegExp }
const GO_GAPS: Record<string, Gap[]> = {
  'sentence-done': [{ reason: 'Task 26: Adjust disclosure in the header' }],
  'error-provider': [
    { reason: 'Task 16: errorEnvHint line and Retry button for server errors' },
  ],
}

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
    // E2E_VISUAL_STRICT=1 runs the known gaps as ordinary tests, so their
    // diff images and ARIA diffs are written (expected failures keep none).
    const gaps = (GO_GAPS[state.name] ?? []).filter(
      (gap) => !gap.projects || gap.projects.test(testInfo.project.name),
    )
    test.fail(
      APP === 'go' && gaps.length > 0 && !process.env.E2E_VISUAL_STRICT,
      gaps.map((gap) => gap.reason).join('; '),
    )
    // Soft, so one run reports the pixel, ARIA template and ARIA tree diffs.
    await expect.soft(page).toHaveScreenshot(`${state.name}.png`, {
      animations: 'disabled',
      caret: 'hide',
      mask: [page.locator('.animate-pulse, .result-cursor')],
      threshold: 0.1,
      maxDiffPixelRatio: 0.001,
    })
    await expect.soft(page.locator('body')).toMatchAriaSnapshot({
      name: `${state.name}.aria.yml`,
    })
    // toMatchAriaSnapshot matches the baseline as a template, so extra nodes
    // pass (children 'contain'; 'deep-equal' cannot work because the stored
    // template drops text already in a node's name). The whole tree must
    // also be identical, so an element only Go renders fails too.
    expect(await page.locator('body').ariaSnapshot()).toMatchSnapshot(
      `${state.name}.aria-tree.txt`,
    )
  })
}
