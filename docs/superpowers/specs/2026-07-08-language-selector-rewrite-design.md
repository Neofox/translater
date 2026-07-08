# Language Selector Rewrite — Design

**Date:** 2026-07-08
**Status:** Approved

## Problem

The current language selectors are small dropdown pills (`LanguageSelect` → `Select` → `Pill`) that are hard to click. Source/target behavior is partially implemented but incomplete:

- Source defaults to `auto` and polish mode (source === target) already exist.
- The pre-flight auto-flip (`resolveTranslationTarget` + `detectLanguage`) only works for script-distinguishable languages — the regex heuristic cannot tell English, French, and Spanish apart.
- The model never reports which languages it actually used, so the UI cannot show the detected source or recover when detection disagrees with the selection.
- The target default is hardcoded to `ko` regardless of the UI language.

## Goals

1. Big, one-click language selection optimized for the dominant EN↔KR use case.
2. Auto source detection with explicit forced-language override.
3. Target default follows the translator UI language (EN UI → `ko`, 한 UI → `en`).
4. Model reports the source/target languages it used; the UI syncs to them.
5. Auto-flip the target when the detected source equals the target — for **all** supported languages, not just CJK-vs-Latin.
6. Same-language selection (source === target, both manual) stays the existing polish mode.

## Design

### 1. `LanguageChipBar` component (new)

Replaces `LanguageSelect` in `InputPanel` and `OutputPanel` headers.

- **Source bar:** `[Auto] [English] [한국어] [▾]`
- **Target bar:** `[English] [한국어] [▾]`
- Chips ~40px tall (min-h-10) with generous horizontal padding. Selected chip gets the accent fill; polish mode keeps the existing `active` tone on both bars.
- `▾` ("more") opens the existing Floating-UI listbox (`Select` internals reused) with the remaining languages (ja/fr/es/zh minus any already shown).
- Picking a "more" language adds it as a 4th chip, persisted per side in localStorage (`nt.recentSource` / `nt.recentTarget`) so it stays one click away.
- The Auto chip shows live detection inline: `Auto · English`. Selection **stays on Auto** — clicking a concrete chip is what forces a language.
- Props: `kind: 'source' | 'target'`, `value`, `onChange`, `detected?: LangCode | null` (source only), `polish?: boolean`, `aria-label`.
- Test IDs: `data-testid="lang-chip"` + `data-value="<code>"` per chip; `data-testid="lang-more-trigger"` for the ▾ button; listbox options keep `data-testid="select-option"` + `data-value`. CLAUDE.md selector table updated accordingly.

### 2. Client-side detection rewrite (`src/lib/detectLanguage.ts`)

- CJK fast path stays regex-based: hangul → `ko`, kana → `ja`, hanzi without kana → `zh`.
- Latin-script text goes through **`tinyld/light`** (new dependency, ~35KB) restricted to `en` / `fr` / `es`.
- Returns `null` for empty input or low-confidence results.
- `resolveTranslationTarget` and the auto-flip effect in `TranslatorContext` are unchanged in shape: `source === 'auto' && detected === target` → flip (`en` → `ko`, everything else → `en`). The flip now fires correctly for FR/ES input pre-flight.

### 3. Schema + prompts: model reports used languages

- Add `sourceLang` and `targetLang` — `z.enum(['en','ko','ja','fr','es','zh','other'])` — as the **first two fields** of both `SentenceResult` and `WordResult` (streams early, before `main`).
  - `sourceLang`: the actual language of the source text. When the request forces a source, echo the forced code.
  - `targetLang`: the language the output is written in.
- Prompt changes in `src/server/prompts.ts`:
  - Forced source (`source !== 'auto'`): "The source language IS X — interpret the text as X even if it resembles another language. Set `sourceLang` to X."
  - Auto source: "Detect the source language and report it in `sourceLang`."
  - All few-shot assistant JSON blobs (sentence EN/KO, polish EN/KO, word × 3 modes × 2 uiLangs) gain the two fields.
- `CACHE_VERSION` bumps to `v10-strict` in `src/server/translate.ts`.

### 4. UI sync + one-shot safety-net re-run

- The Auto chip's detected label prefers the model-reported `sourceLang` from the live partial when available, falling back to the client heuristic while typing.
- Safety net (in `TranslatorContext`): when a result completes with `source === 'auto'` and `data.sourceLang === target` (and not polish), flip the target once and let the debounced effect re-run. A ref keyed on the input text guards against loops — max one extra API call per input. With tinyld this path should almost never fire.
- Forcing a language via chip click changes `source`/`target` args, which re-runs via the existing debounce — no new re-run machinery needed.
- `sourceLang === 'other'` renders no detection label and never triggers the safety net.

### 5. Target default follows UI language

`useTranslationPrefs` takes the UI language and uses `uiLang === 'ko' ? 'en' : 'ko'` as the `nt.target` default. A persisted value always wins after first use.

### 6. Out of scope

- No swap button, no central language bar (chip-bar layout chosen instead).
- No changes to mode toggle, learning tips placement, or word/sentence intent detection.
- No expansion of the supported language list.

## Testing

- Unit tests: rewritten `detectLanguage` (CJK fast path, EN/FR/ES discrimination, empty/low-confidence → null); existing `resolveTranslationTarget.test.ts` extended for the new detector outputs.
- `npx tsc --noEmit` clean.
- `npx tsx scripts/smoke-translate.mjs` passes (validates new schema fields end-to-end).
- cmux browser pass: chips clickable, Auto shows detection, forcing a chip re-runs, EN↔KR flip works, polish mode reachable by setting source === target.
