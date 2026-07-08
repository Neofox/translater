# Language Selector Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small language dropdown pills with big one-click chip bars, make the model report the languages it actually used, and make auto-detection work for all supported languages (not just CJK-vs-Latin).

**Architecture:** A new `LanguageChipBar` component (fixed chips + a "more" dropdown reusing the existing Floating-UI `Select`) replaces `LanguageSelect` in both panels. `detectLanguage` gains `tinyld/light` for Latin-script discrimination. `SentenceResult`/`WordResult` gain `sourceLang`/`targetLang` enum fields that stream first; `TranslatorContext` shows the detection on the Auto chip and runs a one-shot safety-net target flip when the model disagrees with the pre-flight heuristic.

**Tech Stack:** TanStack Start (React 19), Tailwind v4, Floating UI, Zod 4 + OpenAI Responses API strict structured output, vitest, tinyld (new).

**Spec:** `docs/superpowers/specs/2026-07-08-language-selector-rewrite-design.md`

## Global Constraints

- Package manager is **pnpm** (`pnpm-lock.yaml` present). Use `pnpm add` / `pnpm test`. Typecheck is `npx tsc --noEmit`.
- Test runner is **vitest** (`pnpm test` runs `vitest run`). Logic tests need no DOM; component tests must carry a `// @vitest-environment jsdom` pragma on line 1.
- Schemas are OpenAI **strict** structured outputs: every field required, no `.optional()`/`.default()`.
- Supported language codes: `'auto' | 'en' | 'ko' | 'ja' | 'fr' | 'es' | 'zh'` (`LangCode` in `src/lib/languages.ts`). Model-reported codes add `'other'`, never `'auto'`.
- Styling rules from CLAUDE.md: violet accent = action/state, no third accent hue, `Pill`/`Tag` primitives before hand-rolled buttons.
- `CACHE_VERSION` in `src/server/translate.ts` must bump to `'v10-strict'` in the same commit that changes schemas/prompts.
- Follow existing comment style: sparse, explaining constraints only.

---

### Task 1: Rewrite `detectLanguage` with tinyld for Latin scripts

**Files:**

- Modify: `src/lib/detectLanguage.ts`
- Create: `src/lib/detectLanguage.test.ts`
- Modify: `package.json` (via `pnpm add tinyld`)

**Interfaces:**

- Consumes: `tinyld/light` — `detectAll(text: string, opts?: { only?: string[] }): Array<{ lang: string; accuracy: number }>`
- Produces: `detectLanguage(text: string): LangCode | null` — same signature as today, so `resolveTranslationTarget` and `TranslatorContext` keep working unchanged. Never returns `'auto'`.

- [ ] **Step 1: Install tinyld**

```bash
pnpm add tinyld
```

Expected: `tinyld ^1.3.4` appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/detectLanguage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectLanguage } from './detectLanguage'

describe('detectLanguage', () => {
  it('detects Korean from hangul', () => {
    expect(detectLanguage('안녕하세요, 오늘 뭐 해요?')).toBe('ko')
  })

  it('detects Japanese even when kanji outnumber kana', () => {
    expect(detectLanguage('図書館に行く')).toBe('ja')
  })

  it('detects Chinese from hanzi without kana', () => {
    expect(detectLanguage('我今天要去图书馆看书')).toBe('zh')
  })

  it('detects English', () => {
    expect(detectLanguage('How are you doing today?')).toBe('en')
  })

  it('distinguishes French from English', () => {
    expect(detectLanguage("Bonjour, comment ça va aujourd'hui ?")).toBe('fr')
  })

  it('distinguishes Spanish from English', () => {
    expect(
      detectLanguage('Hola, ¿cómo estás hoy? Espero que todo vaya bien.'),
    ).toBe('es')
  })

  it('falls back to English for short ambiguous Latin text', () => {
    expect(detectLanguage('ok')).toBe('en')
  })

  it('keeps the dominant script for mixed input', () => {
    expect(detectLanguage('회의 meeting 일정 조율 부탁드려요')).toBe('ko')
  })

  it('returns null for empty input', () => {
    expect(detectLanguage('   ')).toBe(null)
  })

  it('returns null for digits and punctuation only', () => {
    expect(detectLanguage('1234 !?')).toBe(null)
  })
})
```

- [ ] **Step 3: Run tests to verify the new ones fail**

```bash
pnpm test -- src/lib/detectLanguage.test.ts
```

Expected: French and Spanish tests FAIL (current regex returns `'en'` for any Latin text). Japanese-kanji test FAILS (current code counts 図書館 as `zh`). CJK/empty tests pass.

- [ ] **Step 4: Rewrite the implementation**

Replace the body of `src/lib/detectLanguage.ts`:

```ts
import { detectAll } from 'tinyld/light'
import type { LangCode } from './languages'

// Client-side detector for routing decisions (auto-flip target, Auto-chip label).
// CJK scripts are unambiguous, so counting characters is reliable and free.
// Latin scripts all look alike to a regex, so we hand those to tinyld restricted
// to the Latin languages we support. Low confidence falls back to English —
// wrong-but-stable beats flickering, and the model's own report corrects us.
const LATIN_LANGS = ['en', 'fr', 'es']
const MIN_ACCURACY = 0.5

export function detectLanguage(text: string): LangCode | null {
  const t = text.trim()
  if (!t) return null

  const kana = (t.match(/[぀-ゟ゠-ヿ]/g) ?? []).length
  const hangul = (t.match(/[가-힯]/g) ?? []).length
  const hanzi = (t.match(/[一-鿿]/g) ?? []).length
  const latin = (t.match(/[A-Za-z]/g) ?? []).length

  const cjk = kana + hangul + hanzi
  if (cjk > 0 && cjk >= latin) {
    // Any kana means Japanese — kanji-heavy sentences would otherwise count as zh.
    if (kana > 0 && kana + hanzi >= hangul) return 'ja'
    return hangul >= hanzi ? 'ko' : 'zh'
  }

  if (latin === 0) return null

  const best = detectAll(t, { only: LATIN_LANGS })[0]
  return best && best.accuracy >= MIN_ACCURACY ? (best.lang as LangCode) : 'en'
}
```

If tinyld confidently mislabels a Latin fixture, lengthen the fixture text to an unambiguous phrase rather than weakening `MIN_ACCURACY` below what real typing produces.

- [ ] **Step 5: Run the full unit suite**

```bash
pnpm test
```

Expected: all tests PASS, including the pre-existing `resolveTranslationTarget.test.ts` (it feeds `detectLanguage` output into the flip logic).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/detectLanguage.ts src/lib/detectLanguage.test.ts package.json pnpm-lock.yaml
git commit -m "feat: tinyld-backed language detection for Latin scripts"
```

---

### Task 2: Model reports used languages (schema + prompts + cache bump)

**Files:**

- Modify: `src/server/schemas.ts`
- Modify: `src/server/schemas.test.ts`
- Create: `src/server/prompts.test.ts`
- Modify: `src/server/prompts.ts`
- Modify: `src/server/translate.ts:56` (CACHE_VERSION)
- Modify: `scripts/smoke-translate.mjs`

**Interfaces:**

- Produces: `SentenceResult` and `WordResult` each gain, as their FIRST two fields, `sourceLang` and `targetLang` typed `z.enum(['en','ko','ja','fr','es','zh','other'])`. Task 5 reads `live.partial.sourceLang`.

- [ ] **Step 1: Write the failing schema tests**

In `src/server/schemas.test.ts`, update `validResult` to include the new fields (this test will fail until the schema accepts them AND rejects their absence):

```ts
const validResult = {
  sourceLang: 'zh',
  targetLang: 'en',
  main: 'School life',
  rationale: 'A direct translation.',
  alternatives: [],
  formalityNote: '',
  learningTips: {
    grammar: '',
    vocab: '',
    characters: ['學', '校', '生'].map(characterEntry),
  },
}
```

Add two tests to the `describe('SentenceResult')` block:

```ts
it('rejects payloads missing sourceLang/targetLang', () => {
  const { sourceLang: _s, targetLang: _t, ...without } = validResult
  expect(() => SentenceResult.parse(without)).toThrow()
})

it('rejects unknown language codes', () => {
  expect(() =>
    SentenceResult.parse({ ...validResult, sourceLang: 'auto' }),
  ).toThrow()
})
```

- [ ] **Step 2: Write the failing few-shot round-trip tests**

Create `src/server/prompts.test.ts` — every few-shot assistant blob must parse against the strict schema, which forces the new fields into all 12 blobs:

```ts
import { describe, expect, it } from 'vitest'
import { sentencePrompt, wordPrompt } from './prompts'
import { SentenceResult, WordResult } from './schemas'

const MODES = ['friends', 'casual', 'professional'] as const
const UI_LANGS = ['en', 'ko'] as const

function assistantOf(msgs: Array<{ role: string; content: string }>): unknown {
  const m = msgs.find((x) => x.role === 'assistant')
  if (!m) throw new Error('no assistant few-shot in prompt')
  return JSON.parse(m.content)
}

describe('few-shot payloads satisfy the strict schemas', () => {
  for (const uiLang of UI_LANGS) {
    for (const mode of MODES) {
      it(`sentence translate uiLang=${uiLang} mode=${mode}`, () => {
        const msgs = sentencePrompt({
          text: 'hi',
          source: 'auto',
          target: 'ko',
          mode,
          uiLang,
        })
        expect(() => SentenceResult.parse(assistantOf(msgs))).not.toThrow()
      })
      it(`sentence polish uiLang=${uiLang} mode=${mode}`, () => {
        const msgs = sentencePrompt({
          text: 'hi',
          source: 'en',
          target: 'en',
          mode,
          uiLang,
        })
        expect(() => SentenceResult.parse(assistantOf(msgs))).not.toThrow()
      })
      it(`word translate uiLang=${uiLang} mode=${mode}`, () => {
        const msgs = wordPrompt({
          text: 'hi',
          source: 'en',
          target: 'ko',
          mode,
          uiLang,
        })
        expect(() => WordResult.parse(assistantOf(msgs))).not.toThrow()
      })
      it(`word polish uiLang=${uiLang} mode=${mode}`, () => {
        const msgs = wordPrompt({
          text: 'hi',
          source: 'en',
          target: 'en',
          mode,
          uiLang,
        })
        expect(() => WordResult.parse(assistantOf(msgs))).not.toThrow()
      })
    }
  }
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm test -- src/server
```

Expected: FAIL — schema doesn't know `sourceLang`, few-shots lack the fields.

- [ ] **Step 4: Add the fields to both schemas**

In `src/server/schemas.ts`, above `SentenceResult`, add:

```ts
const UsedLang = z.enum(['en', 'ko', 'ja', 'fr', 'es', 'zh', 'other'])
```

Then add as the FIRST two fields of BOTH `SentenceResult` and `WordResult` object literals (first so they stream before `main`/`headword`):

```ts
  sourceLang: UsedLang.describe(
    'The actual language of the source text. When the instructions name a forced source language, echo its code. Otherwise report the language you detected. Use "other" only when the language is not in this list.',
  ),
  targetLang: UsedLang.describe(
    'The language the output (`main` / `primaryTranslation` and alternatives) is actually written in.',
  ),
```

- [ ] **Step 5: Add language-reporting instructions to both prompts**

In `src/server/prompts.ts`, inside `sentencePrompt`, insert into the `system` array immediately AFTER the translator/editor line (the `isPolish ? 'You are an editor…' : 'You are a translator…'` entry):

```ts
    source === 'auto'
      ? 'LANGUAGE REPORTING: Detect the source language yourself. Set `sourceLang` to its code (en/ko/ja/fr/es/zh, or "other" if none fits) and `targetLang` to the code of the language you actually wrote the output in. Generate these two fields FIRST.'
      : `LANGUAGE REPORTING: The source language IS ${langName(source)} — interpret the text as ${langName(source)} even if it resembles another language. Set \`sourceLang\` to "${source}" and \`targetLang\` to "${target}". Generate these two fields FIRST.`,
```

Insert the exact same conditional entry into the `system` array of `wordPrompt`, immediately after its dictionary/thesaurus line.

- [ ] **Step 6: Add the fields to all 12 few-shot blobs**

Each few-shot constant wraps `assistant: JSON.stringify({ ... })`. Add `sourceLang` and `targetLang` as the FIRST two keys of that object. Example for `SENTENCE_FEWSHOT_EN`:

```ts
const SENTENCE_FEWSHOT_EN = {
  user: 'How are you doing today?',
  assistant: JSON.stringify({
    sourceLang: 'en',
    targetLang: 'ko',
    main: '오늘 어떻게 지내요?',
    // …rest unchanged
```

Exact values per constant:

| Constant                       | sourceLang | targetLang |
| ------------------------------ | ---------- | ---------- |
| `SENTENCE_FEWSHOT_EN`          | `'en'`     | `'ko'`     |
| `SENTENCE_FEWSHOT_KO`          | `'ko'`     | `'en'`     |
| `SENTENCE_POLISH_FEWSHOT_EN`   | `'en'`     | `'en'`     |
| `SENTENCE_POLISH_FEWSHOT_KO`   | `'ko'`     | `'ko'`     |
| `WORD_FEWSHOT_FRIENDS_EN`      | `'en'`     | `'ko'`     |
| `WORD_FEWSHOT_CASUAL_EN`       | `'en'`     | `'ko'`     |
| `WORD_FEWSHOT_PROFESSIONAL_EN` | `'en'`     | `'ko'`     |
| `WORD_FEWSHOT_FRIENDS_KO`      | `'ko'`     | `'en'`     |
| `WORD_FEWSHOT_CASUAL_KO`       | `'ko'`     | `'en'`     |
| `WORD_FEWSHOT_PROFESSIONAL_KO` | `'ko'`     | `'en'`     |
| `WORD_POLISH_FEWSHOT_EN`       | `'en'`     | `'en'`     |
| `WORD_POLISH_FEWSHOT_KO`       | `'ko'`     | `'ko'`     |

Also update the `FIELD ORDER` line in `wordPrompt`'s system array to include the new fields first:

```ts
    'FIELD ORDER: Generate `sourceLang`, `targetLang`, `headword`, `primaryTranslation`, `primaryUsageNote`, and `alternativeTranslations` FIRST. Then `posList` and all remaining fields. The user sees streamed output — the translation must appear before dictionary detail.',
```

- [ ] **Step 7: Bump the cache version**

In `src/server/translate.ts`, change:

```ts
const CACHE_VERSION = 'v10-strict'
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
pnpm test
```

Expected: PASS, including all 24 prompts.test.ts cases.

- [ ] **Step 9: Extend the smoke script**

In `scripts/smoke-translate.mjs`, add after `assertEnglish`:

```js
function assertLangs(label, obj, src, tgt) {
  if (obj.sourceLang === src && obj.targetLang === tgt) {
    console.log(
      `  ✓ ${label} — sourceLang=${obj.sourceLang} targetLang=${obj.targetLang}`,
    )
  } else {
    console.warn(
      `  ⚠ ${label} — expected ${src}→${tgt}, got ${obj.sourceLang}→${obj.targetLang}`,
    )
  }
}
```

Add `assertLangs(...)` after each existing `assertEnglish`/polish check: `s1` → `('EN→KR langs', s1.data, 'en', 'ko')`, `s2` → `('KR→EN langs', s2.data, 'ko', 'en')`, `w1` → `('thanks langs', w1.data, 'en', 'ko')`, `p1` → `('polish langs', p1.data, 'ko', 'ko')`. Then add one auto-detection case at the end of the `try` block:

```js
const s4 = await run('AUTO(fr)→EN casual (sentence)', 'sentence', {
  text: "Bonjour, comment ça va aujourd'hui ?",
  source: 'auto',
  target: 'en',
  mode: 'casual',
})
assertLangs('auto-detect French', s4.data, 'fr', 'en')
```

Do NOT run the smoke script yet (costs API calls) — it runs once in Task 6.

- [ ] **Step 10: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/server scripts/smoke-translate.mjs
git commit -m "feat: model reports sourceLang/targetLang in structured output"
```

---

### Task 3: Target default follows UI language

**Files:**

- Modify: `src/hooks/useTranslationPrefs.ts`

**Interfaces:**

- Consumes: `useUiLang()` from `src/hooks/useUiLang.tsx` (already mounted above `TranslatorProvider`).
- Produces: unchanged hook signature — `{ input, setInput, source, setSource, target, setTarget, mode, setMode }`.

Why an effect instead of a smarter `usePersistentState` default: `uiLang` renders as `'en'` on first paint (SSR determinism) and only hydrates to `'ko'` in an effect, so the default must be corrected reactively — but only when the user has never persisted a target.

- [ ] **Step 1: Implement**

Replace `src/hooks/useTranslationPrefs.ts` with:

```ts
import { useEffect, useState } from 'react'
import { usePersistentState } from '../lib/usePersistentState'
import { useUiLang } from './useUiLang'
import type { LangCode } from '../lib/languages'
import type { Mode } from '../lib/types'

export function useTranslationPrefs() {
  const [input, setInput] = useState<string>('')
  const { lang: uiLang } = useUiLang()

  const [source, setSource] = usePersistentState<LangCode>('nt.source', 'auto')
  const [target, setTarget] = usePersistentState<LangCode>('nt.target', 'ko')
  const [mode, setMode] = usePersistentState<Mode>('nt.mode', 'casual')

  // Default target mirrors the UI language (EN UI → ko, 한 UI → en). uiLang
  // hydrates async, so correct the default reactively — but only until the
  // user has ever chosen a target (a persisted value always wins).
  useEffect(() => {
    try {
      if (window.localStorage.getItem('nt.target') == null && uiLang === 'ko') {
        setTarget('en')
      }
    } catch {
      /* ignore */
    }
  }, [uiLang, setTarget])

  return {
    input,
    setInput,
    source,
    setSource,
    target,
    setTarget,
    mode,
    setMode,
  }
}

export type TranslationPrefs = ReturnType<typeof useTranslationPrefs>
```

- [ ] **Step 2: Verify manually**

```bash
npx tsc --noEmit && pnpm test
```

Expected: clean. (Behavior check lands in Task 6's browser pass: with localStorage cleared and UI toggled to 한, target chip must read English.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTranslationPrefs.ts
git commit -m "feat: default target language follows UI language"
```

---

### Task 4: `LanguageChipBar` component (+ Pill/Select/i18n support)

**Files:**

- Modify: `src/components/ui/Pill.tsx` (add `lg` size)
- Modify: `src/components/ui/Select.tsx` (add `size`, `placeholder`, `data-testid` props)
- Modify: `src/lib/i18n.ts` (add `moreLanguages` key to both locales)
- Create: `src/components/LanguageChipBar.tsx`
- Create: `src/components/LanguageChipBar.test.tsx`

**Interfaces:**

- Consumes: `Pill`, `Select`, `LANGUAGES`/`LangCode`, `usePersistentState`, `useUiLang`.
- Produces: `<LanguageChipBar kind="source" | "target" value={LangCode} onChange={(v: LangCode) => void} detected={LangCode | null} aria-label={string} />` — `detected` only meaningful for `kind="source"`. Task 5 mounts it in both panels.

- [ ] **Step 1: Add the `lg` Pill size**

In `src/components/ui/Pill.tsx`, extend:

```ts
type Size = 'sm' | 'md' | 'lg'
```

```ts
const sizeClass: Record<Size, string> = {
  sm: 'gap-1.5 px-2 py-1 text-xs',
  md: 'gap-2 px-3 py-1.5 text-sm',
  lg: 'gap-2 px-3.5 py-2 text-sm',
}
```

- [ ] **Step 2: Add `size` / `placeholder` / `data-testid` props to Select**

In `src/components/ui/Select.tsx`:

```ts
type Props<V extends string> = {
  value: V
  onChange: (next: V) => void
  options: ReadonlyArray<SelectOption<V>>
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
  /** Trigger content when `value` is not among `options` (chip-bar "more" trigger). */
  placeholder?: ReactNode
  'aria-label'?: string
  'data-testid'?: string
}
```

Destructure `size = 'sm'`, `placeholder`, `'data-testid': testId = 'select-trigger'` and update the trigger:

```tsx
      <Pill
        ref={refs.setReference}
        tone={tone}
        size={size}
        aria-label={ariaLabel}
        aria-expanded={open}
        data-testid={testId}
        {...getReferenceProps()}
      >
        <span>{selected?.label ?? placeholder ?? value}</span>
```

- [ ] **Step 3: Add the i18n key**

In `src/lib/i18n.ts`, add to the `en` strings object:

```ts
    moreLanguages: 'More languages',
```

and to the `ko` strings object:

```ts
    moreLanguages: '다른 언어',
```

(If `StringKey` is derived from the `en` record this is automatic; otherwise extend the key union too.)

- [ ] **Step 4: Write the failing component tests**

Create `src/components/LanguageChipBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LanguageChipBar from './LanguageChipBar'
import { UiLangProvider } from '../hooks/useUiLang'

function renderBar(props: Partial<Parameters<typeof LanguageChipBar>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <UiLangProvider>
      <LanguageChipBar
        kind="source"
        value="auto"
        onChange={onChange}
        {...props}
      />
    </UiLangProvider>,
  )
  return { onChange }
}

const chip = (code: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-testid="lang-chip"][data-value="${code}"]`,
  )

beforeEach(() => window.localStorage.clear())

describe('LanguageChipBar', () => {
  it('source bar renders Auto, English, 한국어 chips and a more trigger', () => {
    renderBar()
    expect(chip('auto')).toBeTruthy()
    expect(chip('en')).toBeTruthy()
    expect(chip('ko')).toBeTruthy()
    expect(screen.getByTestId('lang-more-trigger')).toBeTruthy()
  })

  it('target bar has no Auto chip', () => {
    renderBar({ kind: 'target', value: 'ko' })
    expect(chip('auto')).toBeNull()
  })

  it('clicking a chip calls onChange with its code', () => {
    const { onChange } = renderBar()
    fireEvent.click(chip('en')!)
    expect(onChange).toHaveBeenCalledWith('en')
  })

  it('marks the selected chip with aria-pressed', () => {
    renderBar({ value: 'en' })
    expect(chip('en')!.getAttribute('aria-pressed')).toBe('true')
    expect(chip('auto')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('Auto chip shows the detected language inline', () => {
    renderBar({ detected: 'en' })
    expect(chip('auto')!.textContent).toContain('English')
  })

  it('a non-fixed selection appears as a recent chip', () => {
    renderBar({ value: 'ja' })
    expect(chip('ja')).toBeTruthy()
    expect(chip('ja')!.getAttribute('aria-pressed')).toBe('true')
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

```bash
pnpm test -- src/components/LanguageChipBar.test.tsx
```

Expected: FAIL — module `./LanguageChipBar` not found. (If vitest complains about JSX/jsdom, check `vite.config`/`vitest.config` for a `test` block; the `@vitest-environment jsdom` pragma plus the existing `@vitejs/plugin-react` in the vite config should suffice.)

- [ ] **Step 6: Implement the component**

Create `src/components/LanguageChipBar.tsx`:

```tsx
import { useEffect } from 'react'
import { LANGUAGES } from '../lib/languages'
import type { LangCode } from '../lib/languages'
import { usePersistentState } from '../lib/usePersistentState'
import { useUiLang } from '../hooks/useUiLang'
import Pill from './ui/Pill'
import Select from './ui/Select'

type Kind = 'source' | 'target'

type Props = {
  kind: Kind
  value: LangCode
  onChange: (v: LangCode) => void
  /** Auto-detected language shown inline on the Auto chip (source bar only). */
  detected?: LangCode | null
  'aria-label'?: string
}

const FIXED: Record<Kind, ReadonlyArray<LangCode>> = {
  source: ['auto', 'en', 'ko'],
  target: ['en', 'ko'],
}

const labelFor = (code: LangCode) =>
  LANGUAGES.find((l) => l.code === code)?.label ?? code

export default function LanguageChipBar({
  kind,
  value,
  onChange,
  detected,
  'aria-label': ariaLabel,
}: Props) {
  const { t } = useUiLang()
  const fixed = FIXED[kind]
  const [recent, setRecent] = usePersistentState<LangCode | null>(
    kind === 'source' ? 'nt.recentSource' : 'nt.recentTarget',
    null,
  )

  // A language picked from the "more" dropdown earns a persistent 4th chip so
  // it stays one click away next time.
  useEffect(() => {
    if (!fixed.includes(value) && value !== recent) setRecent(value)
  }, [value, recent, fixed, setRecent])

  const chips: ReadonlyArray<LangCode> =
    recent && !fixed.includes(recent) ? [...fixed, recent] : fixed
  const moreOptions = LANGUAGES.filter(
    (l) => l.code !== 'auto' && !chips.includes(l.code),
  ).map((l) => ({ value: l.code, label: l.label, searchLabel: l.promptName }))
  const moreSelected = !chips.includes(value)

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex flex-wrap items-center gap-1.5"
    >
      {chips.map((code) => {
        const selected = value === code
        return (
          <Pill
            key={code}
            size="lg"
            tone={selected ? 'active' : 'neutral'}
            aria-pressed={selected}
            data-testid="lang-chip"
            data-value={code}
            onClick={() => onChange(code)}
          >
            {code === 'auto' && selected && detected ? (
              <>
                {labelFor('auto')}
                <span className="text-ink-dim">·</span>
                <span>{labelFor(detected)}</span>
              </>
            ) : (
              labelFor(code)
            )}
          </Pill>
        )
      })}
      <Select
        value={value}
        onChange={onChange}
        options={moreOptions}
        size="lg"
        tone={moreSelected ? 'active' : 'neutral'}
        placeholder="⋯"
        aria-label={t('moreLanguages')}
        data-testid="lang-more-trigger"
      />
    </div>
  )
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm test -- src/components/LanguageChipBar.test.tsx
```

Expected: all 6 PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/ui/Pill.tsx src/components/ui/Select.tsx src/lib/i18n.ts src/components/LanguageChipBar.tsx src/components/LanguageChipBar.test.tsx
git commit -m "feat: LanguageChipBar with big one-click language chips"
```

---

### Task 5: Wire chip bars into the panels + detection sync + safety-net flip

**Files:**

- Modify: `src/context/TranslatorContext.tsx`
- Modify: `src/components/InputPanel.tsx:45-51`
- Modify: `src/components/OutputPanel.tsx:30-35`
- Delete: `src/components/LanguageSelect.tsx`

**Interfaces:**

- Consumes: `LanguageChipBar` (Task 4), `live.partial.sourceLang` (Task 2), `fallbackTargetFor` from `src/lib/resolveTranslationTarget.ts`.
- Produces: `TranslatorContextValue` gains `detected: LangCode | null` (model-reported when available, else client heuristic; `null` when source is forced).

- [ ] **Step 1: Extend TranslatorContext**

In `src/context/TranslatorContext.tsx`:

1. Import `fallbackTargetFor` alongside `resolveTranslationTarget`.
2. Add `detected: LangCode | null` to `TranslatorContextValue`.
3. After the `useTranslate` call, derive the model-reported source language. Streaming partials can hold a truncated enum value (e.g. `"e"`), so only accept complete known codes:

```ts
// Streaming partials can carry a truncated sourceLang (partial-json cuts
// mid-string), so only trust complete known codes. 'other' renders nothing.
const VALID_DETECTED: ReadonlyArray<LangCode> = [
  'en',
  'ko',
  'ja',
  'fr',
  'es',
  'zh',
]
const reportedSource = live?.partial.sourceLang
const modelDetected = VALID_DETECTED.includes(reportedSource as LangCode)
  ? (reportedSource as LangCode)
  : null
const detected = source === 'auto' ? (modelDetected ?? rawDetected) : null
```

4. Add the safety-net flip after that block. The client heuristic already flips pre-flight for everything tinyld catches; this handles the residue where the model disagrees. Ref-guarded per input text so it can never loop:

```ts
// Safety net: the model says the source language IS the current target
// (something the client heuristic missed). Flip the target once and let the
// debounced effect re-run. Guarded per input text — max one extra call.
const flipGuardRef = useRef<string | null>(null)
useEffect(() => {
  if (!live?.done || source !== 'auto' || isPolish) return
  const reported = live.partial.sourceLang
  if (!reported || reported === 'other') return
  if (reported !== target) return
  if (flipGuardRef.current === input) return
  flipGuardRef.current = input
  setTarget(fallbackTargetFor(reported))
}, [live, source, target, input, isPolish, setTarget])
```

5. Add `detected` to the `value` object.

- [ ] **Step 2: Swap the selector in InputPanel**

In `src/components/InputPanel.tsx`: replace the `LanguageSelect` import with `LanguageChipBar`, pull `detected` from `useTranslatorContext()` (drop `isPolish` if now unused in this file — check: it's only used for the `polish` prop), and replace the JSX:

```tsx
<LanguageChipBar
  kind="source"
  value={source}
  onChange={setSource}
  detected={detected}
  aria-label={t('sourceLanguage')}
/>
```

- [ ] **Step 3: Swap the selector in OutputPanel**

In `src/components/OutputPanel.tsx`: same import swap (drop `isPolish` from the destructure ONLY if unused — it is still used for the `polishing` streaming label, so keep it) and replace the JSX:

```tsx
<LanguageChipBar
  kind="target"
  value={target}
  onChange={setTarget}
  aria-label={t('targetLanguage')}
/>
```

- [ ] **Step 4: Delete the old component**

```bash
git rm src/components/LanguageSelect.tsx
```

Then confirm nothing else imports it:

```bash
grep -rn "LanguageSelect" src/
```

Expected: no matches.

- [ ] **Step 5: Typecheck, test, commit**

```bash
npx tsc --noEmit && pnpm test
git add -A src/
git commit -m "feat: chip-bar language selectors with model-synced detection"
```

---

### Task 6: Docs, smoke test, and end-to-end browser verification

**Files:**

- Modify: `CLAUDE.md` (Testing & Browser Automation section)

- [ ] **Step 1: Update CLAUDE.md stable selectors**

In the "Stable selectors" table, replace the two `select-trigger` rows with:

```markdown
| Language chip (by value) | `[data-testid="lang-chip"][data-value="en"]` | Big chip buttons; source bar has `auto`, both have `en`/`ko` + recent |
| More-languages trigger | `[data-testid="lang-more-trigger"]` | Opens the Floating-UI listbox with the remaining languages |
```

Keep the `select-option` row (the listbox options are unchanged). Update the "Driving the custom dropdown" example to click `lang-more-trigger` first, and note that source vs. target bars are disambiguated by the group's `aria-label` (`Source language` / `Target language`), e.g. `[aria-label='Source language'] [data-testid='lang-chip'][data-value='en']`. Update the "Page structure snapshot" combobox lines to chip groups.

- [ ] **Step 2: Full unit + type pass**

```bash
pnpm test && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 3: Run the smoke script (real API calls — needs `OPENAI_API_KEY` in `.env`)**

```bash
npx tsx scripts/smoke-translate.mjs
```

Expected: every case prints `✓ … sourceLang=… targetLang=…` lines including `✓ auto-detect French — sourceLang=fr targetLang=en`. Warnings (`⚠`) on language reporting mean the prompt instruction needs strengthening — fix before proceeding.

- [ ] **Step 4: Browser verification**

Start the dev server (`npm run dev`, port 3000) and drive it (cmux browser or manual):

1. Chips render in both panels; each chip ≥ ~36px tall and clickable.
2. Type `how are you` with source=Auto → Auto chip shows `Auto · English`; target stays/flips to 한국어; translation streams.
3. Clear input (clear button), paste `안녕하세요 잘 지내요?` → Auto chip shows `Auto · 한국어`, target flips to English automatically.
4. Click the `한국어` source chip while target=한국어 → polish mode (streaming label says polishing / 다듬는 중).
5. Open `lang-more-trigger`, pick 日本語 → it becomes a 4th chip and stays after reload.
6. DevTools → Application → clear localStorage, toggle UI to 한 → target defaults to English.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: chip-bar selectors in browser automation guide"
```

---

## Self-Review Notes

- Spec §1 → Task 4/5; §2 → Task 1; §3 → Task 2; §4 → Task 5; §5 → Task 3; testing → every task + Task 6.
- `detected` is `null` whenever `source !== 'auto'` — forced source shows no detection label, per spec.
- The safety net reads `live.partial.sourceLang` only when `live.done`, so truncated enum values can't trigger it; the display path filters through `VALID_DETECTED`.
- `fallbackTargetFor` accepts a `LangCode`; the reported value is narrowed to exclude `'other'` before the call.
