# Source Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Open Design Option 1 and carry its clearer hierarchy to Duo.

**Architecture:** Compose a desktop ReferencePanel below InputPanel's editor.
SentenceView/WordView accept a content selection so existing renderers show
alternatives in output and references beside source without duplicating data.
Compact views retain one result scroll and their keyboard layout.

**Tech Stack:** React, Tailwind v4, Vitest browser with Playwright; npm.

**Spec:** `docs/superpowers/specs/2026-10-27-source-reference-design.md`.

## Global Constraints

- npm only; no dependency/provider/telemetry/paid request changes.
- Retain early Copy, alternative speech, Paste/Clear, source cursor/context,
  Safari visible viewport/safe areas and stable unfolded landscape order.
- No POS/action mixing, standalone shortcut keycap, target focus ring or counts.
- Update existing PR6; no merge.

## Review Focus

- Long source and expanded context must leave notes scrollable and actions reachable.
- Main and alternative Copy/Listen keep current-result and streaming guards.
- Desktop notes appear once and dictionary lookup still updates source.
- Resizing and keyboard changes preserve source node, cursor and applied context.
- Empty/error/new result transitions remove obsolete reference content.

## Task 1: Balance references and separate actions

**Files:** create `src/components/ReferencePanel.tsx`; modify InputPanel,
TranslatorWorkspace, SentenceView, WordView, OutputPanel, CopyButton, styles.css,
AGENTS.md and `tests/browser/mobile.browser.tsx`.

**Interfaces:** InputPanel accepts optional children under its composer.
SentenceView/WordView consume `content?: 'all' | 'alternatives' | 'reference'`
(default all). ReferencePanel consumes live result/error/mode from context.
CopyButton accepts optional shortcut text; the main desktop instance supplies it.

- [x] Update geometry tests for a content-sized source with attached actions and
      left-side reference notes; add word metadata/action grouping and reference
      clear/error/streaming checks. Run focused Chromium checks and confirm RED.
- [x] Implement the composed reference pane and view selection, content sizing
      and sticky actions. Apply Open Design's concrete Duo policy when returned.
- [x] Run focused Chromium/WebKit checks, inspect desktop and mobile captures;
      keep existing provenance, speech and Safari regressions green.
- [ ] Update documentation; run unit, browser matrix, typecheck, lint, format and build.
- [ ] Request one fresh review, fix important findings with regressions; commit,
      push and verify updated preview/checks.

## Execution record

- Continuing the user's existing feature branch and PR6 in place, as established
  in this session; no new worktree or execution-method prompt is needed.
- User's Option 1 selection approves the concrete visual design already shown.
  This document records it; the mobile clarification is steering the same task.
- Pre-flight: one task, no cross-task interfaces.

- Focused tests confirmed the old desktop/source-side and mixed metadata layout
  failed before implementation. The completed focused profiles passed, including
  updated short-height disclosure behavior, synonym lookup and compact portrait.
- Fresh review found one Important long-source + expanded-context clipping case;
  reproduced at 580×382 and fixed with a composer height budget, internal scroll
  fallback and sticky controls. Twenty focused Chromium/WebKit checks passed.
- Review reported no Critical, Minor or declined items; no second review needed.
- Unit suite: 268 tests passed. Typecheck, lint, formatting and build passed.
  The final full browser matrix is running before commit and preview delivery.

- Additional visual regression: compact portrait exposed part of the next source
  line. Its scrollport now fits one whole 44px line; RED/GREEN verified. Source
  - context stress includes 34px safe bottom and preserves the source selection.
- Screenshot captures wait for finite entrance transitions so reference metadata
  and alternatives show their settled contrast. Final matrix follows this fix pass.

- Extended the context regression through the error state: disappearing references
  must not remove the composer's size bound or sticky actions. Reproduced clipping
  in both engines; bounded fallback now also covers no-reference/error states.
- Browser startup waits for the stylesheet. Test-only Vite transformation removes
  the remote font import to exercise the app's system fallback without CDN races.
  Confirmed production CSS retains its original font import. All seven Chromium
  profiles passed in the restarted matrix; WebKit verification is still running.
