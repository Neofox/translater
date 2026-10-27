# Stable Streaming Follow-up Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Continue PR 6 in place.

**Goal:** Remove the source-field focus highlight and reduce avoidable streaming layout shifts without delaying translation or early Copy.

**Design:** Preserve the approved A layout. Keep keyboard focus outlines on actual controls. Keep the actual Copy, Listen and refinement controls in place, disabled until ready. Use placeholders only for generated wording and incomplete alternative text; remove the temporary three-line output block. The streaming spinner uses the fixed Swap icon slot so language chips do not gain/lose width. Natural text wrapping can still increase content height; no fixed-height clipping or large permanent blank panels.

## Task 1

- [x] Reproduce geometry changes for main Copy, language controls, alternatives and explanation loading; assert incomplete results expose no playable speech/refinement actions.
- [x] Remove the source-field focus border rule; preserve control focus styles.
- [x] Keep actual main/alternative Listen buttons and sentence refinement controls mounted, disabled according to readiness. Match wording/alternative placeholders to their real rows. Remove the generic block that vanishes at completion.
- [x] Verify early Copy, completion-only speech, stale/error/clear behavior and empty/long/word results. Run the whole unit suite, affected streaming/layout tests at all seven sizes in Chromium/WebKit, full representative desktop/mobile browser profiles, typecheck, lint, scoped formatting and build. Capture streaming/completed proof.
- [x] Fresh review, fix important findings, commit and update PR 6.

## Verification

- Reproduced the original source-border highlight and 3–9px wording-placeholder movement, 30px vertical stream-completion movement and 50px toolbar movement in focused browser checks.
- After the fixes, the measured Copy/language/first-alternative anchors stay within 1px when settled content completes, with early Copy still enabled while details stream.
- 270 unit tests passed. 70 targeted focus/streaming checks passed across all 14 Chromium/WebKit profiles at seven MacBook/Duo sizes. Both complete representative suites passed: Chromium MacBook14 and WebKit folded portrait, 104 checks total.
- Typecheck, lint, scoped formatting and production build passed. No paid calls. Fresh read-only review found no actionable findings or deferred issues.
- Captured waiting, main-ready, details-streaming and complete states at all seven sizes in the local `translator-streaming-review` gallery.

Natural text wrapping, newly arriving sections and optional empty notes can still change content height. These changes remove avoidable control/skeleton movement without holding back the main translation or fixing/clipping content heights. Physical Duo Safari verification remains a device check.

## Static-control correction

User feedback clarified that known controls must render their actual icons and labels throughout loading. Remove Listen/refinement control skeletons. Keep Copy and Listen visible but disabled until their existing readiness rules permit action; keep sentence refinement controls mounted and disabled during loading or stale/pending state. Alternative text/notes may use skeletons, while their action icons remain real disabled buttons. Keep the same control DOM nodes through main-result completion and retain the generated-text skeletons and fixed toolbar spinner.

Validation for this correction: 274 unit tests passed, including three stale tone/target/context regressions that failed before the request-identity fix. Seventy targeted checks passed across all 14 MacBook/Duo Chromium/WebKit profiles; both full representative profiles passed 104 checks. Typecheck, lint, scoped formatting and build passed. Fresh review identified the stale-settings guard deficiency; it was fixed and verified. No deferred findings. Previous statements about hiding loading controls are superseded by this explicit requirement.
