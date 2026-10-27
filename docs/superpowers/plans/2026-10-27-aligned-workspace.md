# Aligned Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce approved A while preserving conversation speed and Safari keyboard behavior.

**Architecture:** Continue the existing PR 6 feature branch. Keep layout detection and translation/speech state boundaries; change split ordering, extract main explanation into the output, and share pane/control styles. Keep reference rendering for source dictionary data and learning tips.

**Tech Stack:** React, TanStack Start, Tailwind v4, Vitest, Playwright browser provider; npm.

**Spec:** `docs/superpowers/specs/2026-10-27-aligned-workspace.md`

## Global Constraints

- Source LEFT and result RIGHT in every side-by-side layout; portrait result first.
- Preserve early Copy, fast Paste/Clear, speech guards and Safari keyboard/focus/insets.
- Minimum 44px touch targets. Identical Copy/Listen dimensions. No visible shortcut hint.
- Use npm; no provider, prompt, dependency or paid API changes.

## Review Focus

- Partial/stale/error results must retain early Copy provenance and speech guards.
- Long source plus reply context must leave Paste/Clear reachable and reference content scrollable.
- Keyboard panning must preserve source node, selection and fixed side-by-side order.
- Asymmetric safe insets must belong to the correct outer pane after ordering changes.
- Word usage must sit with translation without duplicating dictionary or learning content.

### Task 1: Implement approved A composition and layout

**Files:** Modify `src/hooks/useWorkspaceLayout.ts`, `src/components/{InputPanel,OutputPanel,ReferencePanel,SentenceView,WordView,AlternativeItem,CopyButton}.tsx`, `src/styles.css`; create `src/components/MainExplanation.tsx`; update `src/hooks/useWorkspaceLayout.test.tsx` and `tests/browser/mobile.browser.tsx`.

**Interfaces:** Consume existing `LiveResult`, `WorkspaceLayout` and context. Produce `MainExplanation({ live, registerLabel, streaming })`, with main rationale/usage exclusively in output. Retain SentenceView/WordView `content` modes for alternatives and source reference.

- [x] Write assertions for source-first landscape before/after keyboard, main explanation before actions/alternatives in output, source tips/dictionary left, usage right, equal primary action boxes and no visible shortcut. Update superseded placement assertions and run targeted unit/browser tests to confirm failures.
- [x] Extract explanation and adjust view composition, split ordering and compact alternative actions. Wrap editable field content without changing portrait sizing logic.
- [x] Match approved shared backgrounds, language alignment, raised source field, quiet alternative rows and equal action geometry. Assign split safe insets to left source/right output.
- [x] Run unit tests and focused browser checks. Verify long/context/error/keyboard/stale Copy behavior using existing regression cases. Fix failures at their cause.
- [x] Run full browser matrix, typecheck, lint, format and build. Compare generated short/alternatives, long and word screenshots for all seven dimensions with Open Design; save a user-facing comparison gallery.
- [x] Commit implementation and verification evidence. Request fresh whole-change review, address important findings, and retain concrete review output for user.

## Verification

270 unit tests passed. The full browser matrix passed 686 checks across 14 profiles. After the final compact-spacing adjustment,98 affected layout checks passed across all 14 profiles. Typecheck, lint, scoped formatting and production build passed. One fresh-review finding (active speech label overflow) was fixed with EN/KO loading/playback geometry regressions. See the verification record for limitations.
