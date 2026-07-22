# AGENTS.md

## Project

Translator app built with **TanStack Start** (React SSR) + **Vite** + **TailwindCSS v4** + **Nitro** (deployed to Vercel). Uses Vercel AI SDK v7 through Vercel AI Gateway with strict structured output (`streamText` + `Output.object`). `TRANSLATE_MODEL` is one exact deployment-controlled `provider/model` identifier (default `openai/gpt-5.6-luna`); there is no fallback model.

## Key Files

| File                                | Role                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/server/prompts.ts`             | All LLM prompt templates and few-shot examples (sentence + word mode, per-mode register guidance)             |
| `src/server/schemas.ts`             | Zod schemas for LLM output (`SentenceResult`, `WordResult`). Strict-mode compliant: every field required.     |
| `src/server/translate.ts`           | Server function — cache check, AI Gateway `streamText`, raw JSON deltas, and final `Output.object` validation |
| `src/server/cache.ts`               | In-memory LRU cache (max 50 entries)                                                                          |
| `src/server/telemetry.ts`           | Optional AI SDK v7 telemetry registration for content-free Langfuse generation traces                         |
| `src/hooks/useTranslate.ts`         | Client hook — streams translation, returns `LiveResult`                                                       |
| `src/lib/detectIntent.ts`           | Heuristic: ≤3 tokens AND ≤24 chars → `word`, else `sentence`                                                  |
| `src/components/SentenceView.tsx`   | Renders sentence-mode results (main, rationale, alternatives, formalityNote)                                  |
| `src/components/WordView.tsx`       | Renders word-mode results (primaryTranslation, alternatives, register tags)                                   |
| `src/components/WordSourceMeta.tsx` | Dictionary metadata panel (POS, definitions, etymology, synonyms)                                             |

## Architecture Notes

- Two translation modes: **sentence** and **word**, auto-detected from input.
- Three tone modes: `friends` (slang/반말), `casual` (해요체), `professional` (하십시오체).
- Prompts are multi-message conversations: `developer` (language rule) → `system` (instructions) → few-shot `user`/`assistant` → actual `user` input.
- LLM responses are streamed as incremental JSON fragments (server sends each delta, client accumulates) and parsed via `partial-json`.
- Runtime: AI SDK v7 requires ESM and Node.js 22+. The project declares `"type": "module"`, and Vercel Functions use `nodejs22.x`.
- Gateway routing: authenticate with Vercel-managed `VERCEL_OIDC_TOKEN` by default; `AI_GATEWAY_API_KEY` remains an optional fallback for local or external runtimes. `TRANSLATE_MODEL` must be one exact `provider/model`; the app never sends a fallback model list and sets `maxRetries: 0` so a paid retry requires explicit user action.
- Caching and provider options: Gateway caching is `auto`. For GPT-5.6, OpenAI prompt caching uses `promptCacheOptions: { mode: 'explicit', ttl: '30m' }`; the stable final-user reminder ends with an explicit breakpoint and all live source/context/refinement content follows in a separate text part. OpenAI-only options (`reasoningEffort: 'none'`, `store: false`, `promptCacheKey`, and explicit cache settings) are sent only for `openai/*` models.
- Langfuse is optional and activates only when both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` exist. It uses AI SDK v7's `telemetry` option and `@langfuse/vercel-ai-sdk`, with `recordInputs: false`, `recordOutputs: false`, and an explicit safe `runtimeContext` allowlist. Source text, context, refinements, prompts, outputs, raw bodies, and provider metadata must never be added to telemetry. Configure environment/release through `LANGFUSE_TRACING_ENVIRONMENT` and `LANGFUSE_RELEASE`; serverless requests force-flush after native spans end. Telemetry failures remain non-fatal. Local LRU hits do not call AI SDK and create no Langfuse trace.
- Billing: AI Gateway is authoritative for billed usage and cost. The application does not normalize usage or calculate cost; Langfuse may show its own estimate when its model catalog recognizes the selected model.
- Client debounce is 800ms; paste skips it (`queueImmediate`) and Enter/blur flush a pending run (`flush`). Plain Enter is a newline when nothing is pending; Shift+Enter always newline; Cmd/Ctrl+Enter force-runs.
- Refine + context: `TranslateInput` carries optional `context` (sentence + word), `refinements` + `previousMain` (sentence only, max 3 refinements of which at most one is free-text). They are injected only into the FINAL user message as `<context>`/`<adjustments>` blocks; the explaining system lines are UNCONDITIONAL so the prefix cache stays intact — keep them that way. Refine chips are toggles (`aria-pressed`); toggling one off removes that adjustment and re-runs (LRU makes it cheap). A failed refine rolls back via an internal snapshot stack (no user-facing undo control). Editing the input clears refinements; context is sessionStorage-sticky.

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
| Language chip (by value)   | `[data-testid="lang-chip"][data-value="en"]`     | Big chip buttons; source bar has `auto`, both have `en`/`ko` + recent   |
| More-languages trigger     | `[data-testid="lang-more-trigger"]`              | Opens the Floating-UI listbox with the remaining languages              |
| Dropdown option (by value) | `[data-testid="select-option"][data-value="en"]` | Works for any language code: `auto`, `en`, `ko`, `ja`, `fr`, `es`, `zh` |
| Input textarea             | `[data-testid="input-textarea"]`                 | React controlled input; do **not** clear by direct `.value` mutation    |
| Clear input button         | `[data-testid="clear-input"]`                    | Only rendered when `input` is non-empty                                 |
| Context toggle             | `[data-testid="context-toggle"]`                 | Input panel meta row; opens the "Replying to…" textarea                 |
| Context textarea           | `[data-testid="context-textarea"]`               | Session-sticky; has `[data-testid="context-clear"]` when non-empty      |
| Refine chip (by id)        | `[data-testid="refine-chip-softer"]`             | ids: `softer`, `direct`, `shorter`, `playful`; TOGGLES (`aria-pressed`) |
| Refine free-text           | `[data-testid="refine-freeform"]`                | Enter submits; hidden while a custom adjustment is active               |
| Refine custom button       | `[data-testid="refine-custom"]`                  | Replaces the free-text input (label ≤20 chars); click removes it        |

### Why direct `.value` mutation fails

The textarea is a React controlled component (`value={input}` + `onChange={(e) => setInput(e.target.value)}`). Setting `.value` directly and dispatching an `input` event does **not** sync React state because React's internal `_valueTracker` intercepts changes. Always clear via the **Clear input** button (`[data-testid="clear-input"]`) or type new text over the existing content.

### Driving the language chip bars

Each panel renders a `LanguageChipBar`: a `role="group"` of big `Pill` chips (source bar = `auto`/`en`/`ko` + one persisted "recent" chip; target bar = `en`/`ko` + recent) plus a trailing `⋯` more-languages trigger. Click a chip directly by `data-value` — no dropdown needed for the fixed languages:

```bash
cmux browser --surface <s> click --selector "[data-testid='lang-chip'][data-value='ko']"
```

For a language not already shown as a chip, open the more-languages trigger first, then click the option in the Floating-UI listbox it opens (same listbox/option markup as before — `browser select` still does **not** work on it):

```bash
# 1. Open the "more languages" listbox
cmux browser --surface <s> click --selector "[data-testid='lang-more-trigger']"

# 2. Click the desired option by data-value
cmux browser --surface <s> click --selector "[data-testid='select-option'][data-value='ja']"
```

Picking a language this way promotes it to a persistent 4th chip on that bar (stored in localStorage), so it's directly clickable next time without reopening the listbox.

Disambiguate source vs. target bars via the group's `aria-label` (scope both the chip and the more-trigger selectors under it):

```bash
cmux browser --surface <s> click --selector "[aria-label='Source language'] [data-testid='lang-chip'][data-value='en']"
cmux browser --surface <s> click --selector "[aria-label='Target language'] [data-testid='lang-more-trigger']"
```

**Narrow panels collapse the bar.** Below 640px viewport width — and in the 768–1023px band where the two-column layout makes panels narrow — only the SELECTED chip renders plus the `⋯` trigger; the other languages (including `auto` for the source bar) move into the `⋯` listbox. Automation that clicks `[data-testid="lang-chip"][data-value="..."]` for a non-selected language must either run at ≥1024px (or 640–767px) viewport width, or go through `lang-more-trigger` + `select-option` instead.

### Page structure snapshot (high-level)

```
- button "EN" / button "한"              (UI language toggle)
- button "Friends|Casual|Professional"   (Mode toggle)
  - group "Source language"              (chip bar: Auto / EN / KO [/ recent] + more-trigger)
  - textbox "Input text"                 (textarea)
  - button "Paste clipboard"
  - group "Target language"              (chip bar: EN / KO [/ recent] + more-trigger)
```

### Gotchas discovered

- **Ephemeral refs**: cmux snapshot refs (`[ref=e123]`) change between commands. Never hard-code them in scripts; always prefer `data-testid`, `aria-label`, or `eval` with `querySelector`.
- **Chips vs. dropdown**: The visible chip bars are plain buttons, not a combobox — only the trailing `⋯` trigger opens a Floating-UI listbox (`role="listbox"`, `role="option"`, `aria-expanded`, `aria-selected`). Prefer clicking chips directly; only fall back to the listbox for languages not already promoted to a chip.
- **Auto-swap reset**: The auto-swap logic resets its one-shot flag when the input is cleared. If a test needs to re-trigger swap behavior, clear the textarea first (via the Clear input button), then type the new language.

## Commands

- Typecheck: `npx tsc --noEmit`
- Dev server: `npm run dev`
- Smoke test: `npx tsx scripts/smoke-translate.mjs`
