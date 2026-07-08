# Chip Bar Mobile Layout — Design

**Date:** 2026-07-08
**Status:** Approved
**Follows:** 2026-07-08-language-selector-rewrite-design.md

## Problem

On narrow screens the panel header's single flex-wrap row explodes: four big chips wrap into three rows, and the small utility pills (Copy, Learning Tips, Dictionary/Sentence hint, char counter, clear button) sit beside chips twice their size, looking misaligned and accidental.

## Goals

1. Mobile chip bar never wraps and never scrolls: collapse to `[selected chip] [⋯]`.
2. Desktop chip bar unchanged: `[Auto·detected] [English] [한국어] [recent] [⋯]`.
3. The size mismatch disappears: small utilities move to their own slim "meta row" beneath the chip row, on both breakpoints.
4. Chips keep the big (`lg`) touch size on mobile.

## Design

### 1. Responsive `LanguageChipBar`

A new `useMediaQuery(query: string): boolean` hook (`src/hooks/useMediaQuery.ts`) wraps `window.matchMedia` with a change listener; returns `false` during SSR/first render and corrects on mount (renders the desktop variant momentarily — invisible in practice).

`LanguageChipBar` uses `useMediaQuery('(min-width: 640px)')` (Tailwind `sm`):

- **Desktop (`isDesktop === true`):** current behavior, unchanged — fixed chips + persisted recent chip + `⋯` listbox of the remainder.
- **Mobile:** visible chips = `[value]` only, plus the `⋯` trigger. The `⋯` option list contains **every other selectable language**: for `kind="source"` that includes `auto` when it isn't selected; for `kind="target"`, `auto` is never offered. Selecting an option just calls `onChange` — recent-chip promotion (the `nt.recentSource`/`nt.recentTarget` effect) keeps running regardless of breakpoint so the desktop layout stays in sync with choices made on mobile.
- The Auto chip's inline detection label (`Auto · English`) renders identically on both breakpoints.
- Test IDs unchanged (`lang-chip`, `lang-more-trigger`, `select-option`).

### 2. Two-row panel headers

Both `InputPanel` and `OutputPanel` headers restructure from one flex-wrap row to:

- **Row 1 — languages only.** Chip bar on the left (`flex-nowrap`). OutputPanel keeps the streaming indicator on the right of row 1. Nothing else lives here.
- **Row 2 — meta row.** Rendered only when it has any content:
  - InputPanel: left = `CopyButton` (when input), `LearningTips` (when tips); right = char counter (when shown), Dictionary/Sentence intent hint (when input and not over limit), clear button (when input).
  - OutputPanel: left = `CopyButton` (when copy text), `LearningTips` (when tips). No right side.
  - All meta-row controls keep their current small sizing; the clear button stays 28px round.
- When a panel is empty the header is a single clean row of chips.

### 3. Out of scope

- No changes to schemas, server, prompts, detection, or flip logic.
- No visual redesign of the utility pills themselves; only placement.
- Desktop chip sizes and behavior unchanged.

## Testing

- `useMediaQuery` unit test (jsdom, mocked `matchMedia` with listener dispatch).
- `LanguageChipBar` tests: existing six stay green (desktop default in jsdom mock), plus mobile-mode tests — only the selected chip renders; `⋯` options include `auto` for source when unselected and never for target.
- `pnpm test`, `npx tsc --noEmit` clean.
- Browser pass at a mobile viewport (~390px): single-row chip bar, meta row beneath, no wrap; desktop viewport unchanged; CLAUDE.md gains a note that non-selected chips hide on mobile (affects `lang-chip` selector availability below `sm`).
