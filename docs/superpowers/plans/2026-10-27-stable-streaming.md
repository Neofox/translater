# Stable Streaming Follow-up Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Continue PR 6 in place.

**Goal:** Remove the source-field focus highlight and reduce avoidable streaming layout shifts without delaying translation or early Copy.

**Design:** Preserve the approved A layout. Keep keyboard focus outlines on actual controls. Replace the temporary three-line output block with placeholders in the positions of Listen, refinements, wording and incomplete alternatives. The streaming spinner uses the fixed Swap icon slot so language chips do not gain/lose width. Natural text wrapping can still increase content height; no fixed-height clipping or large permanent blank panels.

## Task 1

- [x] Reproduce geometry changes for main Copy, language controls, alternatives and explanation loading; assert incomplete results expose no playable speech/refinement actions.
- [x] Remove the source-field focus border rule; preserve control focus styles.
- [x] Reserve main/alternative Listen geometry and the sentence refinement row using noninteractive, aria-hidden placeholders. Match wording/alternative placeholders to their real rows. Remove the generic block that vanishes at completion.
- [x] Verify early Copy, completion-only speech, stale/error/clear behavior and empty/long/word results. Run the whole unit suite, affected streaming/layout tests at all seven sizes in Chromium/WebKit, full representative desktop/mobile browser profiles, typecheck, lint, scoped formatting and build. Capture streaming/completed proof.
- [x] Fresh review, fix important findings, commit and update PR 6.

## Verification

- Reproduced the original source-border highlight and 3–9px wording-placeholder movement, 30px vertical stream-completion movement and 50px toolbar movement in focused browser checks.
- After the fixes, the measured Copy/language/first-alternative anchors stay within 1px when settled content completes, with early Copy still enabled while details stream.
- 270 unit tests passed. 70 targeted focus/streaming checks passed across all 14 Chromium/WebKit profiles at seven MacBook/Duo sizes. Both complete representative suites passed: Chromium MacBook14 and WebKit folded portrait, 104 checks total.
- Typecheck, lint, scoped formatting and production build passed. No paid calls. Fresh read-only review found no actionable findings or deferred issues.
- Captured waiting, main-ready, details-streaming and complete states at all seven sizes in the local `translator-streaming-review` gallery.

Natural text wrapping, newly arriving sections and optional empty notes can still change content height. These changes remove avoidable control/skeleton movement without holding back the main translation or fixing/clipping content heights. Physical Duo Safari verification remains a device check.
