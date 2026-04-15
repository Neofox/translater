# AGENTS.md

## Project

Translator app built with **TanStack Start** (React SSR) + **Vite** + **TailwindCSS v4** + **Nitro** (deployed to Vercel). Uses the OpenAI Responses API with structured JSON output (`json_schema`).

## Key Files

| File                                | Role                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/server/prompts.ts`             | All LLM prompt templates and few-shot examples (sentence + word mode, per-mode register guidance)               |
| `src/server/schemas.ts`             | Zod schemas for LLM response validation (`SentenceResult`, `WordResult`). Converted to JSON Schema for the API. |
| `src/server/translate.ts`           | Server function — cache check, LLM call with streaming, temperature per intent/mode                             |
| `src/server/llm.ts`                 | Provider resolution (OpenAI / OpenRouter / LM Studio) via env vars                                              |
| `src/server/cache.ts`               | In-memory LRU cache (max 50 entries)                                                                            |
| `src/hooks/useTranslate.ts`         | Client hook — streams translation, returns `LiveResult`                                                         |
| `src/lib/detectIntent.ts`           | Heuristic: ≤3 tokens AND ≤24 chars → `word`, else `sentence`                                                    |
| `src/components/SentenceView.tsx`   | Renders sentence-mode results (main, rationale, alternatives, formalityNote)                                    |
| `src/components/WordView.tsx`       | Renders word-mode results (primaryTranslation, alternatives, register tags)                                     |
| `src/components/WordSourceMeta.tsx` | Dictionary metadata panel (POS, definitions, etymology, synonyms)                                               |

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

## Commands

- Typecheck: `npx tsc --noEmit`
- Dev server: `npm run dev`
- Smoke test: `node scripts/smoke-translate.mjs`
