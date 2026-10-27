# A Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore A's desktop workspace and reading flow while preserving mobile usability and translation speed.

**Architecture:** Add a desktop `workspace` layout mode with source-first pane order. Replace C's desktop styling with A's full-height source and one result column. Preserve existing compact phone, streaming and keyboard state.

**Tech Stack:** React, TanStack Start, Tailwind v4, Vitest/Playwright; npm.

**Spec:** `docs/superpowers/specs/2026-10-27-a-workspace-design.md` (approved by the user's request).

## Global Constraints

- Use npm. No dependency, model, provider, telemetry or paid API changes.
- Retain fast Paste/Clear, early main Copy and Safari keyboard fixes.
- No target focus ring, demo actions, count badges or redundant formality prose.
- Update PR6 without merging.

## Review Focus

- Native keyboard animation must not reverse desktop source/result order.
- Long source text must scroll inside the editor without hiding footer controls.
- Long results must retain accessible Copy while learner content scrolls.
- Side safe insets belong to each pane's outer edge, not the internal divider.
- Resizing between MacBook and Duo must preserve the source node, cursor and context.

## Task 1: Restore the workspace and prove its behavior

**Files:** `src/context/WorkspaceLayoutContext.tsx`, `src/hooks/useWorkspaceLayout.ts`, `src/hooks/useWorkspaceLayout.test.tsx`, `src/components/InputPanel.tsx`, `src/styles.css`, `tests/browser/mobile.browser.tsx`, `AGENTS.md`.

**Interfaces:** Consume the existing layout context, live-result readiness and source/result components. Produce `mode: 'workspace'` at desktop widths ≥1100px, `desktop: true`, `resultFirst: false`; compact/fold modes retain their order and keyboard semantics.

- [x] Add failing unit/browser tests for the two MacBook panes, source-left order, vertically ordered learner sections, footer reachability and full-height editor.
- [x] Run the targeted tests and confirm they fail against C.
- [x] Implement the layout mode and full-height editor sizing, preserving visual-viewport logic.
- [x] Replace obsolete C desktop card/two-detail-column styles with A tokens, pane boundaries, source footer, 44rem result measure and readable typography.
- [x] Adapt the old two-detail-column regression to the new single-column requirement. Keep all streaming Copy, mobile source/context and keyboard checks.
- [x] Run targeted profiles and inspect MacBook/Duo screenshots. Fix any reproduced clipping or focus failures.
- [x] Update workspace documentation; run unit tests, browser matrix, typecheck, lint, formatting and build.
- [x] Request one fresh review and resolve important findings with regressions.
- [x] Commit/push and verify the updated PR preview.

## Execution record

- Existing `feature/folded-safe-area-cleanup` branch/PR6 is the authorized workspace.
- User explicitly chose A as the baseline and asked for implementation; continuing the established native workflow.
- A layout selection/geometry tests failed against C, then passed in Chromium/WebKit.
- Retained-keyboard Clear regression failed in split/workspace when reply context had focus; blur-before-source-focus and keyboard context folding fixed it while retaining the applied value.
- Fresh review found bottom-only Copy could leave view after long learner notes. Reproduced RED with long wording notes; top/bottom sticky constraints passed GREEN in both engines. Added workspace→folded→unfolded→workspace context/cursor coverage, also green.
- No deferred minor findings or unresolved design decisions.
- Final verification: 268 unit tests and 546 browser checks passed across 14 Chromium/WebKit profiles. Typecheck, lint, formatting and production build passed. Local A gallery includes all seven viewport sizes with short and long text.
- Implementation commit `06246c1` pushed to PR6. Vercel and security checks passed; authenticated preview GET returned HTTP 200 with A theme/assets. PR remains open and unmerged. Physical Duo Safari testing remains a device check; automated keyboard/safe-area coverage passed.
