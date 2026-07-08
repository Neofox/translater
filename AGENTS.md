# AGENTS.md

## Project

Translator app built with **TanStack Start** (React SSR) + **Vite** + **TailwindCSS v4** + **Nitro** (deployed to Vercel). Uses the OpenAI Responses API with strict structured output (`zodTextFormat` from `openai/helpers/zod`). OpenAI is the only provider; model comes from `TRANSLATE_MODEL` (default `gpt-5.4-mini`).

## Key Files

| File                                | Role                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/server/prompts.ts`             | All LLM prompt templates and few-shot examples (sentence + word mode, per-mode register guidance)         |
| `src/server/schemas.ts`             | Zod schemas for LLM output (`SentenceResult`, `WordResult`). Strict-mode compliant: every field required. |
| `src/server/translate.ts`           | Server function — cache check, OpenAI client, streaming via `responses.stream` + `zodTextFormat` (strict) |
| `src/server/cache.ts`               | In-memory LRU cache (max 50 entries)                                                                      |
| `src/hooks/useTranslate.ts`         | Client hook — streams translation, returns `LiveResult`                                                   |
| `src/lib/detectIntent.ts`           | Heuristic: ≤3 tokens AND ≤24 chars → `word`, else `sentence`                                              |
| `src/components/SentenceView.tsx`   | Renders sentence-mode results (main, rationale, alternatives, formalityNote)                              |
| `src/components/WordView.tsx`       | Renders word-mode results (primaryTranslation, alternatives, register tags)                               |
| `src/components/WordSourceMeta.tsx` | Dictionary metadata panel (POS, definitions, etymology, synonyms)                                         |

## Architecture Notes

- Two translation modes: **sentence** and **word**, auto-detected from input.
- Three tone modes: `friends` (slang/반말), `casual` (해요체), `professional` (하십시오체).
- Prompts are multi-message conversations: `developer` (language rule) → `system` (instructions) → few-shot `user`/`assistant` → actual `user` input.
- LLM responses are streamed as partial JSON and parsed incrementally via `partial-json`.
- Temperature: word=0.2, sentence varies by mode (friends=0.85, casual=0.7, professional=0.3).

## Styling

Tailwind v4 with a bi-accent palette defined in `src/styles.css`:

- `--color-accent` / `--color-accent-soft` — **violet**, "action / primary / feedback". Use for: Mode toggle active state, streaming indicator, brand dot, current-mode chips, "Sentence" intent hint, cursor pulse.
- `--color-warm` / `--color-warm-soft` — **amber**, "learner / scholarly / dictionary". Use for: Learning Tips pill, popup section labels (grammar / vocab / hanja·kanji·hanzi), CJK word glyphs, WordSourceMeta section headers (POS, Primary meaning, Etymology, Notes, Synonyms), SentenceView "Context" label, "Dictionary" intent hint.
- `--color-ink` / `--color-ink-soft` / `--color-ink-dim` — neutral grey scale for structure, body copy, borders. Never stack three greys in one control; prefer `text-ink` on `bg-panel` with `border-border` over `text-ink-soft`.

Primitives live in `src/components/ui/`:

- `<Pill tone="neutral | accent | warm" size="sm | md">` — the canonical button-chip shape. Tone tints hover border + inline `<svg>`. Used by `CopyButton`, `LearningTips`. Reach for this before hand-rolling another `inline-flex rounded-md border bg-panel ...` button.
- `<Tag tone="neutral | accent | warm">` — small uppercase chip. Used for register badges, mode chips, POS register tags.

Rules of thumb:

- Never use `text-ink-soft` as button rest color — it compounds into grey-on-grey-on-grey. Use `text-ink` and let hover add the tone.
- Don't introduce a third accent hue. If something needs emphasis and isn't "action" or "learning", it's probably structure (neutral).
- Uppercase section labels (`tracking-wide text-xs font-semibold`) belong to the amber family when they introduce learner content, the violet family when they're state indicators.

## Testing & Browser Automation (cmux)

The project includes browser-friendly `data-testid` attributes on key interactive elements so agents can drive the UI via `cmux browser` without chasing ephemeral `ref=e123` IDs.

### Stable selectors

| Element                    | Selector                                         | Notes                                                                   |
| -------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Source language trigger    | `[data-testid="select-trigger"]`                 | Custom Floating-UI dropdown, not a native `<select>`                    |
| Target language trigger    | `[data-testid="select-trigger"]`                 | Same component; use DOM order or `aria-label` to disambiguate           |
| Dropdown option (by value) | `[data-testid="select-option"][data-value="en"]` | Works for any language code: `auto`, `en`, `ko`, `ja`, `fr`, `es`, `zh` |
| Input textarea             | `[data-testid="input-textarea"]`                 | React controlled input; do **not** clear by direct `.value` mutation    |
| Clear input button         | `[data-testid="clear-input"]`                    | Only rendered when `input` is non-empty                                 |

### Why direct `.value` mutation fails

The textarea is a React controlled component (`value={input}` + `onChange={(e) => setInput(e.target.value)}`). Setting `.value` directly and dispatching an `input` event does **not** sync React state because React's internal `_valueTracker` intercepts changes. Always clear via the **Clear input** button (`[data-testid="clear-input"]`) or type new text over the existing content.

### Driving the custom dropdown

The language pickers are custom Floating-UI listboxes (not native `<select>`). The `browser select` command does **not** work on them. Use this sequence instead:

```bash
# 1. Open the dropdown
cmux browser --surface <s> click --selector "[data-testid='select-trigger']"

# 2. Click the desired option by data-value
cmux browser --surface <s> click --selector "[data-testid='select-option'][data-value='en']"
```

If you need to disambiguate source vs. target triggers, use the `aria-label`:

```bash
cmux browser --surface <s> click --selector "[aria-label='Source language']"
```

### Page structure snapshot (high-level)

```
- button "EN" / button "한"              (UI language toggle)
- button "Friends|Casual|Professional"   (Mode toggle)
  - combobox "Source language"           (Pill trigger + floating listbox)
  - textbox "Input text"                 (textarea)
  - button "Paste clipboard"
  - combobox "Target language"
```

### Gotchas discovered

- **Ephemeral refs**: cmux snapshot refs (`[ref=e123]`) change between commands. Never hard-code them in scripts; always prefer `data-testid`, `aria-label`, or `eval` with `querySelector`.
- **Hidden native `<select>`**: We experimented with adding a visually hidden `<select>` inside the custom dropdown so `browser select` would work natively. It succeeded for automation but leaked into the accessibility tree as a duplicate combobox with concatenated option text, confusing screen readers. The custom dropdown already has proper ARIA (`role="listbox"`, `role="option"`, `aria-expanded`, `aria-selected`), so we removed the hidden select and rely on `data-testid` + `data-value` instead.
- **Auto-swap reset**: The auto-swap logic resets its one-shot flag when the input is cleared. If a test needs to re-trigger swap behavior, clear the textarea first (via the Clear input button), then type the new language.

## Commands

- Typecheck: `npx tsc --noEmit`
- Dev server: `npm run dev`
- Smoke test: `npx tsx scripts/smoke-translate.mjs`
