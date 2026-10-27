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
- Main Copy and its keyboard shortcut become available when the main JSON string closes, while learner details continue streaming. `LiveResult.mainReady` is derived without accepting partial strings; preserve current-request and error guards. Listen and alternative Copy still wait for a completed result.
- Runtime: AI SDK v7 requires ESM and Node.js 22+. The project declares `"type": "module"`, and Vercel Functions use `nodejs22.x`.
- Gateway routing: authenticate with Vercel-managed OIDC by default; in Vercel Functions the token is request-scoped (`x-vercel-oidc-token`) and the AI SDK resolves it through `@vercel/oidc`, so never preflight request authentication from `process.env`. `AI_GATEWAY_API_KEY` remains an optional fallback for local or external runtimes. `TRANSLATE_MODEL` must be one exact `provider/model`; the app never sends a fallback model list and sets `maxRetries: 0` so a paid retry requires explicit user action.
- Caching and provider options: Gateway caching is `auto`. For GPT-5.6, OpenAI prompt caching uses `promptCacheOptions: { mode: 'explicit', ttl: '30m' }`; the stable final-user reminder ends with an explicit breakpoint and all live source/context/refinement content follows in a separate text part. OpenAI-only options (`reasoningEffort: 'none'`, `store: false`, `promptCacheKey`, and explicit cache settings) are sent only for `openai/*` models.
- Langfuse is optional and activates only when both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` exist. It uses AI SDK v7's `telemetry` option and `@langfuse/vercel-ai-sdk`, with `recordInputs: false`, `recordOutputs: false`, and an explicit safe `runtimeContext` allowlist. Source text, context, refinements, prompts, outputs, raw bodies, and provider metadata must never be added to telemetry. Configure environment/release through `LANGFUSE_TRACING_ENVIRONMENT` and `LANGFUSE_RELEASE`; serverless requests force-flush after native spans end. Telemetry failures remain non-fatal. Local LRU hits do not call AI SDK and create no Langfuse trace.
- Billing: AI Gateway is authoritative for billed usage and cost. The application does not normalize usage or calculate cost; Langfuse may show its own estimate when its model catalog recognizes the selected model.
- Client debounce is 800ms; paste skips it (`queueImmediate`) and Enter/blur flush a pending run (`flush`). Plain Enter is a newline when nothing is pending; Shift+Enter always newline; Cmd/Ctrl+Enter force-runs.
- Refine + context: `TranslateInput` carries optional `context` (sentence + word), `refinements` + `previousMain` (sentence only, max 3 refinements of which at most one is free-text). They are injected only into the FINAL user message as `<context>`/`<adjustments>` blocks; the explaining system lines are UNCONDITIONAL so the prefix cache stays intact — keep them that way. Refine chips are toggles (`aria-pressed`); toggling one off removes that adjustment and re-runs (LRU makes it cheap). A failed refine rolls back via an internal snapshot stack (no user-facing undo control). Editing the input clears refinements; context is sessionStorage-sticky.

## Pronunciation and result transitions

- `src/server/speech.ts` is the thin server-function boundary; it dynamically imports `speech.server.ts`. Keep provider code server-only. That module uses `generateSpeech` with `maxRetries: 0` and explicit `telemetry.isEnabled: false` so globally registered translation telemetry cannot record speech. It validates WAV framing/format, discards metadata, and delivers PCM chunks after generation completes.
- `SPEECH_MODEL` chooses one exact Gateway speech model (default `google/gemini-3.8-flash-lite-tts`). `SPEECH_VOICE` is optional; Google defaults to `Kore`. Change deployment env, redeploy, and reload to switch. No fallback or automatic retry. Swaps must support HTTPS `generateSpeech` with mono PCM16 WAV output (8–48 kHz). Gateway currently does not support its experimental WebSocket speech surface.
- `useSpeech` unlocks Web Audio synchronously on tap, streams through `PcmPlayer`, stops on edits/settings changes/unmount/pagehide, and caches only completed audio in a bounded page-memory LRU. Preserve the layout-effect reset: passive cleanup can cancel an immediate tap on a newly completed result.
- Speech limits: 4,000 input characters, 8 MiB audio, 90-second server timeout. Never log source text, raw provider errors, or audio; speech does not register telemetry. `aiSdkWarnings.server.ts` installs a permanent process-wide SDK warning suppression policy because provider warnings have no per-call warning hook; do not temporarily toggle it around requests.
- `OutputPanel` exposes main and alternative Listen controls only on completed non-error results; both use the same language, stale/pending guard, and settings reset key. `useSpeech` shares one active playback owner across controls, so starting another voice cancels the previous loading/playing request. Keep owner cleanup guarded by identity. Result `ViewTransition` updates are scheduled at completion/error; run initialization and token deltas stay urgent to preserve live-result provenance. Respect reduced motion.

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

| Element                    | Selector                                         | Notes                                                                                       |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Language chip (by value)   | `[data-testid="lang-chip"][data-value="en"]`     | Big chip buttons; source bar has `auto`, both have `en`/`ko` + recent (Japanese by default) |
| More-languages trigger     | `[data-testid="lang-more-trigger"]`              | Opens the Floating-UI listbox with the remaining languages                                  |
| Dropdown option (by value) | `[data-testid="select-option"][data-value="en"]` | Works for any language code: `auto`, `en`, `ko`, `ja`, `fr`, `es`, `zh`                     |
| Input textarea             | `[data-testid="input-textarea"]`                 | React controlled input; do **not** clear by direct `.value` mutation                        |
| Paste clipboard button     | `[data-testid="paste-input"]`                    | Always available; replaces the current turn                                                 |
| Clear input button         | `[data-testid="clear-input"]`                    | Always available; clears the current turn, preserves context and focuses source             |
| Context toggle             | `[data-testid="context-toggle"]`                 | Input panel meta row; opens the "Replying to…" textarea                                     |
| Context textarea           | `[data-testid="context-textarea"]`               | Session-sticky; has `[data-testid="context-clear"]` when non-empty                          |
| Refine chip (by id)        | `[data-testid="refine-chip-softer"]`             | ids: `softer`, `direct`, `shorter`, `playful`; TOGGLES (`aria-pressed`)                     |
| Refine free-text           | `[data-testid="refine-freeform"]`                | Enter submits; hidden while a custom adjustment is active                                   |
| Refine custom button       | `[data-testid="refine-custom"]`                  | Replaces the free-text input (label ≤20 chars); click removes it                            |

Main pronunciation is `[data-testid="output-toolbar"] [data-testid="listen-button"]`; alternatives are `[data-testid="alternative-item"] [data-testid="listen-button"]`. Scope queries to the row or toolbar because completed results have several Listen buttons.

### Why direct `.value` mutation fails

The textarea is a React controlled component (`value={input}` + `onChange={(e) => setInput(e.target.value)}`). Setting `.value` directly and dispatching an `input` event does **not** sync React state because React's internal `_valueTracker` intercepts changes. Always clear via the **Clear input** button (`[data-testid="clear-input"]`) or type new text over the existing content.

### Driving the language chip bars

Each panel renders a `LanguageChipBar`: a `role="group"` of big `Pill` chips (source bar = `auto`/`en`/`ko` + one persisted "recent" chip; target bar = `en`/`ko` + recent) plus a trailing `More…` dropdown trigger. Click a chip directly by `data-value` — no dropdown needed for the fixed languages:

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

**Narrow panels collapse the bar.** A ResizeObserver measures the language group's available width after toolbar actions: source chips expand at 320px, target chips at 280px. Below those widths, only the SELECTED chip renders plus the `More…` trigger; other languages (including `auto` for the source bar) move into the listbox. This also handles split windows and folded displays. Automation should check whether a chip is rendered and otherwise use `lang-more-trigger` + `select-option`, rather than assuming viewport width guarantees an expanded bar.

**Optional fold layouts.** With Safari's Device Posture and Viewport Segments feature flags enabled, book posture places source and result in separate horizontal segments. Laptop posture places the result above the fold and input below it; `useFoldLayout` measures the header offset so the boundary matches the physical fold. Unsupported browsers keep the standard responsive layout. These layouts use CSS feature queries, never device-name detection.

### Workspace layout

`TranslatorWorkspace` owns the shell and shares `useWorkspaceLayout` through
`WorkspaceLayoutContext`. A's desktop `workspace` mode starts at 1100px of usable
width: source on the left, result on the right, with one result reading column.
Option 1 sizes the source editor to content (capped for long text), with
Paste/Clear and reply context directly beneath it. A separately scrollable
`ReferencePanel` fills the remaining source pane with wording, dictionary and
learning notes. Layout selection uses the unoccluded viewport, with the measured
panel height retained for sizing. Compact portrait places the result first and composer below.
Landscape at 560–1099px of usable width stays split before, during and after typing.
Other compact stacked layouts keep the result first. The hook retains the
pre-keyboard height through incremental resize events while editing, and tracks
visualViewport height and offsetTop on both resize and scroll. The fixed shell
follows the visible area without introducing root scroll. Keyboard entry resets
the result scroll to its main translation and preserves focus/drafts. Fold media use
physical viewport segments where available; no device-name detection.

Desktop reference details stay open in a single column, contained to a 44rem
measure. Workspace, split and physical book layouts place notes under source;
output retains main translation, actions/refinements and always-open alternatives.
Split/book notes collapse at short visible heights and stay in the same pane
when the keyboard opens. Portrait/laptop retain notes after alternatives in the
result scroll, as disclosures. `SentenceView` and `WordView` select `all`,
`alternatives` or `reference` content, avoiding duplicate metadata. Dictionary
metadata and synonym lookup live in reference content. POS appears there once,
never in the Copy/Listen action group. Desktop Copy contains its shortcut hint. The target scroll surface has no focus ring;
buttons, menus and selects retain visible keyboard focus.

Main result text is `[data-testid="main-translation"]`, its scroll surface is
`[data-testid="translation-result"]`, and its Copy/Listen/refinements are inside
`[data-testid="output-toolbar"]`. Main Copy is enabled once its JSON string is complete,
even while details stream, and remains disabled for stale results/settings debounce.
`LiveResult.requestKey` captures the
request settings in page memory; `resultIsCurrent` guards main/alternative actions
and the keyboard shortcut. Source Paste/Clear suppress blur flushing for a draft
being discarded. The source language header hides in short stacked layouts. Both source actions remain visible and labelled on empty and filled input.

Completed compact stacked turns condense the source into one editable row with
Paste, Clear and an expand control. Preserve the same textarea node/cursor and
keyboard focus when the main result becomes ready. Keep that compact state while
the next edit is pending; Clear resets it, explicit expansion exposes languages
and reply context, and input-limit warnings bypass condensing. Close paths must
reset the context-focus state before unmounting a focused context field. Applied
reply context remains indicated on the compact expand control. Phone result
Copy/Listen controls use 44px icon targets with accessible names/tooltips;
desktop main actions retain labels. Keep the composer inset from safe-area edges.

Use A's background/surface tokens and type scale. Do not restore the obsolete C
desktop top-composer card, word/action grid or two-column learner layout. Workspace
textarea auto-grows to its capped content height; compact layouts retain their
existing auto-sizing/condensing behavior. A whole source line stays visible in
the compact portrait editor. Paste uses tonal violet, keeping Copy strongest.
Keep long-result actions reachable.
Ordinary language menus may extend beyond a short composer into the viewport;
workspace/book/laptop/split panes constrain popups to their own pane. Popup
padding must still include the applicable safe-area insets.

Safe-area padding belongs on the header/composer/result controls, never on the
whole `.app-shell`: backgrounds must still cover the viewport. The `--safe-area-*`
variables alias browser `env()` values and allow nonzero-inset browser tests.
Responsive breakpoints use the width left after side insets. Split columns share
that usable width before adding their outer insets; both split panes protect the
bottom edge. A tight keyboard hides the header; transfer its remaining top safe
inset to the shell, accounting for visualViewport offsetTop. The compact typing
composer keeps Paste/Clear reachable without reserving an extra bottom inset
already excluded by the keyboard. Keep sticky Copy safe with long results and
the software keyboard, not just with one-line fixtures. Keyboard tests must
simulate incremental visual-viewport shrink/pan separately from layout viewport size.

### Page structure snapshot (high-level)

```
- heading Translater
- group Tone (Friends / Casual / Professional; select on narrow screens)
- group UI language (EN / 한)
- section Source text
  - group Source language
  - textbox Input text
  - button Paste clipboard
  - button Clear input
  - button Replying to… / context field
- section Translation
  - group Target language
  - scroll surface Translation (no focus ring)
    - main result, Copy, Listen, refinements
    - Alternatives / Why this wording / Learning tips
```

### Gotchas discovered

- **Ephemeral refs**: cmux snapshot refs (`[ref=e123]`) change between commands. Never hard-code them in scripts; always prefer `data-testid`, `aria-label`, or `eval` with `querySelector`.
- **Chips vs. dropdown**: The visible chip bars are plain buttons, not a combobox — only the trailing `⋯` trigger opens a Floating-UI listbox (`role="listbox"`, `role="option"`, `aria-expanded`, `aria-selected`). Prefer clicking chips directly; only fall back to the listbox for languages not already promoted to a chip.
- **Auto-swap reset**: The auto-swap logic resets its one-shot flag when the input is cleared. If a test needs to re-trigger swap behavior, clear the textarea first (via the Clear input button), then type the new language.

## Commands

Use npm for this project. Commit `package-lock.json` with dependency changes; use `npm ci` for reproducible installs.

- Typecheck: `npm run typecheck`
- Dev server: `npm run dev`
- Unit tests: `npm test`
- Browser dependencies: `npx playwright install chromium webkit`
- Browser matrix: `npm run test:browser` (Chromium/WebKit at seven folded/unfolded phone and MacBook sizes, synthetic speech; no paid calls). Browser fixtures wait for CSS and use the system-font fallback to avoid external font CDN startup/screenshot races. Production font loading is unchanged.
- Replay report: `npm run test:browser:report` (serves `test-results/browser/index.html`)
- Interactive browser tests: `npm run test:browser:ui`
- Translation smoke test: `npx tsx scripts/smoke-translate.mjs` (real, potentially billed Gateway request)
- Speech smoke test: `npx tsx scripts/smoke-speech.mjs` (one real, potentially billed request; optional output WAV path argument; `DOTENV_CONFIG_PATH` selects local credentials)
- Vercel: `vercel.json` runs `npm ci` followed by `npm run build`, using the committed npm lockfile.
