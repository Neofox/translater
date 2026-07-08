# Chip Bar Mobile Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the language chip bar to `[selected chip] [⋯]` on narrow panels and move all small utility controls to a dedicated meta row beneath the chips.

**Architecture:** A `useMediaQuery` hook drives a collapsed/expanded mode inside `LanguageChipBar` (visible chips and `⋯` option list change; recent-chip persistence keeps running in both modes). `InputPanel`/`OutputPanel` headers restructure from one flex-wrap row into a languages-only row plus a conditional meta row holding Copy/Tips/counter/intent/clear at their existing small size.

**Tech Stack:** React 19, Tailwind v4, Floating UI, vitest + @testing-library/react (jsdom via `// @vitest-environment jsdom` pragma).

**Spec:** `docs/superpowers/specs/2026-07-08-chipbar-mobile-design.md`

## Global Constraints

- Package manager **pnpm**; tests `pnpm test`; typecheck `npx tsc --noEmit`. Known harmless noise: a `close timed out` teardown warning at the end of `pnpm test`.
- The collapse media query is exactly `'(min-width: 640px) and (max-width: 767px), (min-width: 1024px)'` — TRUE means expanded. (Panels are full-width below `md` 768px and half-width above, so 768–1023px panels are too narrow for the full chip set.)
- Test IDs must not change: `lang-chip` (+`data-value`), `lang-more-trigger`, `select-option`.
- jsdom does NOT implement `window.matchMedia` — every jsdom test that renders `LanguageChipBar` must stub it first (helper below).
- `useUiLang`/`UiLangProvider` wrapper required for components using `t()`.
- Meta-row controls keep their current sizes (Pill default `sm`, clear button `h-7 w-7`). Chips stay `lg` in both modes.
- Follow existing comment style: sparse, explaining constraints only.

---

### Task 1: `useMediaQuery` hook + responsive `LanguageChipBar`

**Files:**

- Create: `src/hooks/useMediaQuery.ts`
- Create: `src/hooks/useMediaQuery.test.ts`
- Modify: `src/components/LanguageChipBar.tsx`
- Modify: `src/components/LanguageChipBar.test.tsx`

**Interfaces:**

- Produces: `useMediaQuery(query: string): boolean` — `false` on SSR/first render, syncs in an effect, tracks changes. `LanguageChipBar`'s public props are UNCHANGED (`kind`, `value`, `onChange`, `detected?`, `'aria-label'?`); Task 2 relies on that.

- [ ] **Step 1: Write the failing hook test**

Create `src/hooks/useMediaQuery.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMediaQuery } from './useMediaQuery'

type Listener = (e: { matches: boolean }) => void

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches: initial,
    media: '',
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return {
    fire(matches: boolean) {
      mql.matches = matches
      listeners.forEach((cb) => cb({ matches }))
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('useMediaQuery', () => {
  it('reports the current match state after mount', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery('(min-width: 640px)'))
    expect(result.current).toBe(true)
  })

  it('tracks change events', () => {
    const media = stubMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery('(min-width: 640px)'))
    expect(result.current).toBe(false)
    act(() => media.fire(true))
    expect(result.current).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test -- src/hooks/useMediaQuery.test.ts`
Expected: FAIL — module `./useMediaQuery` not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useMediaQuery.ts`:

```ts
import { useEffect, useState } from 'react'

// SSR and the first client render report `false` so hydration matches; the
// effect syncs to the real match state on mount and tracks changes.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
```

- [ ] **Step 4: Run the hook tests**

Run: `pnpm test -- src/hooks/useMediaQuery.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 5: Update the chip-bar tests — stub matchMedia, add collapsed-mode tests**

In `src/components/LanguageChipBar.test.tsx`:

1. Add the same `stubMatchMedia` helper (copy it — test files don't share helpers in this repo) and imports for `vi`, `afterEach` if missing.
2. In `beforeEach`, alongside `window.localStorage.clear()`, call `stubMatchMedia(true)` so all EXISTING tests run in expanded mode (they assert the full chip set). Add `afterEach(() => vi.unstubAllGlobals())`.
3. Append these tests inside the `describe`:

```tsx
it('collapsed mode renders only the selected chip plus the more trigger', () => {
  stubMatchMedia(false)
  renderBar({ value: 'en' })
  expect(chip('en')).toBeTruthy()
  expect(chip('auto')).toBeNull()
  expect(chip('ko')).toBeNull()
  expect(screen.getByTestId('lang-more-trigger')).toBeTruthy()
})

it('collapsed source bar offers auto in the more listbox when not selected', () => {
  stubMatchMedia(false)
  renderBar({ value: 'en' })
  fireEvent.mouseDown(screen.getByTestId('lang-more-trigger'))
  expect(
    document.querySelector('[data-testid="select-option"][data-value="auto"]'),
  ).toBeTruthy()
})

it('collapsed target bar never offers auto', () => {
  stubMatchMedia(false)
  renderBar({ kind: 'target', value: 'ko' })
  fireEvent.mouseDown(screen.getByTestId('lang-more-trigger'))
  expect(
    document.querySelector('[data-testid="select-option"][data-value="auto"]'),
  ).toBeNull()
  expect(
    document.querySelector('[data-testid="select-option"][data-value="en"]'),
  ).toBeTruthy()
})
```

Note the listbox opens on `mousedown` (Floating UI `useClick(context, { event: 'mousedown' })` in `Select.tsx`), hence `fireEvent.mouseDown`. Options render in a portal on `document.body`, so query `document`, not the container. If a later `stubMatchMedia(false)` call inside a test doesn't take effect because the component already mounted, stub BEFORE `renderBar` (as written above) — the hook reads `window.matchMedia` in its mount effect.

- [ ] **Step 6: Run chip-bar tests to verify the new ones fail**

Run: `pnpm test -- src/components/LanguageChipBar.test.tsx`
Expected: existing 6 still PASS (component doesn't call matchMedia yet — the stub is inert), the 3 new ones FAIL (collapsed mode doesn't exist: auto/ko chips still render, auto option missing).

- [ ] **Step 7: Make `LanguageChipBar` responsive**

In `src/components/LanguageChipBar.tsx`:

1. Add import: `import { useMediaQuery } from '../hooks/useMediaQuery'`
2. Add a module-level constant above `FIXED`:

```ts
// Expanded only when the panel is wide: full-width panels on small screens
// (640-767px) or two wide columns (>=1024px). In the 768-1023px band the
// two-column layout makes each panel too narrow for the full chip set.
const EXPANDED_QUERY =
  '(min-width: 640px) and (max-width: 767px), (min-width: 1024px)'
```

3. Inside the component, after the `recent` state:

```ts
const isExpanded = useMediaQuery(EXPANDED_QUERY)
```

4. Replace the `chips` / `moreOptions` computation:

```ts
const expandedChips: ReadonlyArray<LangCode> =
  recent && !fixed.includes(recent) ? [...fixed, recent] : fixed
// Collapsed (narrow panel): only the active language stays a chip; every
// other choice moves into the ⋯ listbox — including `auto` for the source.
const chips: ReadonlyArray<LangCode> = isExpanded ? expandedChips : [value]
const moreOptions = LANGUAGES.filter(
  (l) => (kind === 'source' || l.code !== 'auto') && !chips.includes(l.code),
).map((l) => ({ value: l.code, label: l.label, searchLabel: l.promptName }))
const moreSelected = !chips.includes(value)
```

Everything else (recent-promotion effect, chip rendering, Select usage) stays identical — the effect keeps running in collapsed mode by design so the expanded layout stays in sync.

- [ ] **Step 8: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit`
Expected: all PASS (9 chip-bar tests, 2 hook tests, everything else untouched), typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useMediaQuery.ts src/hooks/useMediaQuery.test.ts src/components/LanguageChipBar.tsx src/components/LanguageChipBar.test.tsx
git commit -m "feat: collapse language chip bar to selected chip on narrow panels"
```

---

### Task 2: Two-row panel headers (meta row)

**Files:**

- Modify: `src/components/InputPanel.tsx:43-84`
- Modify: `src/components/OutputPanel.tsx:28-45`

**Interfaces:**

- Consumes: `LanguageChipBar` (props unchanged from Task 1).
- Produces: no API changes — pure JSX restructure. No new tests (visual layout; covered by Task 3's browser pass); existing suite must stay green.

- [ ] **Step 1: Restructure the InputPanel header**

In `src/components/InputPanel.tsx`, replace the header `<div>` (the one starting `className="shrink-0 flex items-center justify-between gap-2 px-3 py-2..."` and everything inside it, down to its matching close before the textarea wrapper) with:

```tsx
<div className="shrink-0 px-3 py-2 text-sm text-ink-soft sm:px-4">
  <LanguageChipBar
    kind="source"
    value={source}
    onChange={setSource}
    detected={detected}
    aria-label={t('sourceLanguage')}
  />
  {input && (
    <div className="mt-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <CopyButton text={input} />
        <LearningTips tips={inputTips} />
      </div>
      <div className="flex items-center gap-2">
        {showCounter && (
          <span
            className={`text-xs font-medium tabular-nums ${counterTone}`}
            aria-live="polite"
          >
            {counterText}
          </span>
        )}
        {!overLimit && (
          <span
            className={`text-xs font-medium ${intent === 'word' ? 'text-warm' : 'text-accent'}`}
          >
            {intent === 'word' ? t('intentWord') : t('intentSentence')}
          </span>
        )}
        <button
          type="button"
          onClick={clearInput}
          title={t('clearInputTitle')}
          aria-label={t('clearInput')}
          data-testid="clear-input"
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border bg-panel text-ink transition hover:border-accent/60"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )}
</div>
```

Semantics preserved from the old markup: the meta row only exists when `input` is non-empty, which was already the visibility condition for CopyButton, the intent hint, and the clear button; `LearningTips` renders its own empty state and `inputTips` is only ever set while a translation (thus input) exists, so gating the whole row on `input` loses nothing. The inner `{input && ...}` guards are dropped because the row itself is gated.

- [ ] **Step 2: Restructure the OutputPanel header**

In `src/components/OutputPanel.tsx`, replace the header `<div>` (starting `className="flex items-center justify-between gap-2 px-4 py-2..."`) with:

```tsx
<div className="px-4 py-2 text-sm text-ink-soft">
  <div className="flex items-center justify-between gap-2">
    <LanguageChipBar
      kind="target"
      value={target}
      onChange={setTarget}
      aria-label={t('targetLanguage')}
    />
    {streaming && (
      <span className="inline-flex items-center gap-1.5 text-xs text-accent">
        <Loader2 size={12} className="animate-spin" />
        {isPolish ? t('polishing') : t('streaming')}
      </span>
    )}
  </div>
  {(copyText || outputTips) && (
    <div className="mt-2 flex items-center gap-2">
      {copyText && <CopyButton text={copyText} />}
      <LearningTips tips={outputTips} />
    </div>
  )}
</div>
```

- [ ] **Step 3: Run the suite + typecheck**

Run: `pnpm test && npx tsc --noEmit`
Expected: all PASS, typecheck clean. If typecheck flags an unused import in either panel after the restructure, remove that import.

- [ ] **Step 4: Commit**

```bash
git add src/components/InputPanel.tsx src/components/OutputPanel.tsx
git commit -m "feat: split panel headers into chip row and meta row"
```

---

### Task 3: Browser verification + CLAUDE.md note

**Files:**

- Modify: `CLAUDE.md` ("Driving the language chip bars" subsection)

- [ ] **Step 1: Document the collapsed mode**

In CLAUDE.md's "Driving the language chip bars" subsection, append this paragraph after the disambiguation example:

```markdown
**Narrow panels collapse the bar.** Below 640px viewport width — and in the 768–1023px band where the two-column layout makes panels narrow — only the SELECTED chip renders plus the `⋯` trigger; the other languages (including `auto` for the source bar) move into the `⋯` listbox. Automation that clicks `[data-testid="lang-chip"][data-value="..."]` for a non-selected language must either run at ≥1024px (or 640–767px) viewport width, or go through `lang-more-trigger` + `select-option` instead.
```

- [ ] **Step 2: Browser verification at four widths**

Check if port 3000 is already served (`lsof -i :3000`); start `npm run dev` in the background only if not (kill it afterwards if you started it). Drive http://localhost:3000 with the available browser tooling (cmux per CLAUDE.md, else agent-browser), resizing the viewport per check:

1. **390×844 (phone):** source bar = `[Auto] [⋯]` (or `[Auto · English]` once text is typed) on ONE row, no wrap; type `hello` → meta row appears beneath with small Copy/Tips/Dictionary-hint/clear; nothing sits beside the big chips.
2. **700×900 (small window, one column):** full chip set on one row (`Auto/English/한국어/⋯`), meta row beneath.
3. **800×900 (two narrow columns):** BOTH bars collapsed to `[selected] [⋯]` — no chip wrapping.
4. **1280×900 (desktop):** full chip set, unchanged behavior; open `⋯` on the source bar while collapsed=false and confirm `auto` is NOT in the list.
5. At 390px: open `⋯` on the source bar → `auto` IS offered when not selected; picking 日本語 selects it and the single chip becomes 日本語.

Record each as PASS/FAIL with what you observed. Screenshot at 390px and 1280px if the tooling supports it.

- [ ] **Step 3: Full suite + typecheck one last time**

Run: `pnpm test && npx tsc --noEmit`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: collapsed chip bar behavior for browser automation"
```

---

## Self-Review Notes

- Spec §1 (responsive bar + query) → Task 1; §2 (two-row headers) → Task 2; testing section → Tasks 1 & 3.
- The exact media query appears identically in Global Constraints, Task 1 Step 7, and the spec.
- `LanguageChipBar` props unchanged — Task 2's JSX matches Task 1's interface.
- No placeholders; all code complete.
