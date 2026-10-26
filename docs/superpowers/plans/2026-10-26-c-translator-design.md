# C translator implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the approved C design with real translator behavior.

**Architecture:** Reuse the provider/server boundary. A responsive workspace
orders keyed source/result panels, while shared result sections switch between
static desktop content and compact disclosures. Keep visual rules in the
existing stylesheet and preserve stable interaction selectors.

**Tech Stack:** React 19, TanStack Start, Tailwind v4, TypeScript, Vitest/Playwright.

**Spec:** `docs/superpowers/specs/2026-10-26-c-translator-design.md`

## Global constraints

- Use npm/npx, with rtk around shell commands; no dependency changes.
- Do not change server/provider/model/authentication/telemetry code.
- Preserve 800ms debounce, immediate paste, IME/Enter semantics, sticky context,
  refinement rollback and speech cancellation/owner semantics.
- No target/text-panel focus rings; retain button/menu keyboard indicators.
- No simulated production results or paid test requests.
- Preserve safe areas, fold segment geometry, reduced motion, and 44px actions.

## Review focus

- Resizing or opening the software keyboard must preserve text, selection and
  focus; test it in the full workspace browser fixture.
- Streaming/stale results must not expose enabled outdated Copy/Listen; extend
  OutputPanel tests and retain transition/speech browser regressions.
- Dictionary metadata and synonym lookup must remain available after moving
  the source composer; exercise word mode in the browser fixture.
- Empty/over-limit input, denied clipboard access and Korean UI labels must not
  break the fast source controls; cover source workflow and browser overflow.
- Fold detection and viewport changes must clean up listeners and preserve
  physical hinge alignment; retain fold tests and exercise both postures.

### Task 1: Approved translator workspace

**Files:**

- Create `src/components/TranslatorWorkspace.tsx`, `src/hooks/useWorkspaceLayout.ts`,
  `src/context/WorkspaceLayoutContext.tsx`, `src/components/ResultSection.tsx`.
- Modify `src/routes/index.tsx`, `src/styles.css`, `src/lib/i18n.ts` and the
  InputPanel/OutputPanel/SentenceView/WordView/LearningTips/WordSourceMeta,
  ContextField, ModeToggle, RefineRow, CopyButton, ListenButton and Pill components.
- Test `src/components/TranslatorDesign.test.tsx`, OutputPanel tests, workspace
  layout tests, and `tests/browser/mobile.browser.tsx`; extend browser sizes.

**Interfaces:**

- Consumes the existing `TranslatorContext` and `LiveResult` without schema changes.
- Produces `TranslatorWorkspace()` for the real app and browser fixture, a layout
  context with desktop/tight/fold/order state, and `ResultSection({title, children,
className})` with static desktop headings and compact accessible disclosure.

- [x] Write source workflow tests proving Paste replaces nonempty input and Clear
      remains reachable, focuses input and preserves context; add Copy stale/error
      gating tests and section-disclosure tests. Run the targeted unit tests.
      Expected: FAIL against the current UI's hidden Paste/conditional Clear and
      enabled stale Copy.
- [x] Implement the responsive workspace, composer and reusable sections. Keep
      services/provider hooks untouched. Route real data through shared main-result
      actions and existing sentence/word metadata. Run targeted tests.
      Expected: PASS for the new behavioral tests.
- [x] Extend the full-workspace browser fixture and matrix to cover 382×580,
      594×368, 594×736, 736×594, 1512×982, 1728×1117 and 1488×700. Add tests for
      desktop static columns, source growth/shrink, focus/order on resize, clipboard
      loop, 300-character text, no target focus ring, accessible compact details and
      Korean labels. Run new tests before completing layout polish.
      Expected: assertions expose any missing responsive contracts, then PASS after
      fixes; all existing speech/provenance tests remain green.
- [x] Run `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run build`,
      and lint/format checks scoped to changed code. Visually inspect real component
      fixtures without paid calls, comparing the approved prototype at laptop and
      phone sizes. Expected: all checks PASS, no overflow/hidden primary controls.
- [x] Review React changes, request one fresh whole-branch review, fix material
      findings and rerun affected/full checks. Update project instructions for the
      actual layout/selectors. Commit the implementation on the feature branch.
      Expected: a concrete, verified local implementation with no server changes.
