# AGENTS.md

## Project

Translator app built with **TanStack Start** (React SSR) + **Vite** + **TailwindCSS v4** + **Nitro** (deployed to Vercel). Uses Vercel AI SDK v7 with `@ai-sdk/openai` (direct OpenAI API, Responses) and strict structured output (`streamText` + `Output.object`). `TRANSLATE_MODEL` is one exact deployment-controlled OpenAI model id (default `gpt-6.1-terra` on the Fast tier with reasoning `none`, chosen for time-to-main-translation first and explanation quality second; a legacy `openai/` prefix is stripped); there is no fallback model.

## Key Files

| File                                | Role                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/server/prompts.ts`             | All LLM prompt templates and few-shot examples (sentence + word mode, per-mode register guidance)                              |
| `src/server/schemas.ts`             | Zod schemas for LLM output (`SentenceResult`, `WordResult`). Strict-mode compliant: every field required.                      |
| `src/server/translate.ts`           | Server function — cache check, OpenAI `streamText`, raw JSON deltas, and final `Output.object` validation                      |
| `src/server/translationRequest.ts`  | Shared model-facing request (prompt, schema, reasoning effort, OpenAI options) used by the server, smoke scripts and evals     |
| `src/server/cache.ts`               | In-memory LRU cache (max 50 entries)                                                                                           |
| `src/server/telemetry.ts`           | Optional AI SDK v7 telemetry registration for content-free Langfuse generation traces                                          |
| `src/hooks/useTranslate.ts`         | Client hook — streams translation, returns `LiveResult`                                                                        |
| `src/lib/detectIntent.ts`           | Heuristic: ≤3 tokens AND ≤24 chars → `word`, else `sentence`                                                                   |
| `src/components/SentenceView.tsx`   | Renders sentence-mode results (main, rationale, alternatives, formalityNote)                                                   |
| `src/components/WordView.tsx`       | Renders word-mode results (primaryTranslation, alternatives, register tags)                                                    |
| `src/components/WordSourceMeta.tsx` | Dictionary metadata panel (POS, definitions, etymology, synonyms)                                                              |

## Architecture Notes

- Two translation modes: **sentence** and **word**, auto-detected from input.
- Three tone modes: `friends` (slang/반말), `casual` (해요체), `professional` (하십시오체).
- Prompts are multi-message conversations: `developer` (language rule) → `system` (instructions) → few-shot `user`/`assistant` → actual `user` input.
- LLM responses are streamed as incremental JSON fragments (server sends each delta, client accumulates) and parsed via `partial-json`.
- Main Copy and its keyboard shortcut become available when the main JSON string closes, while learner details continue streaming. `LiveResult.mainReady` is derived without accepting partial strings; preserve current-request and error guards. Listen and alternative Copy still wait for a completed result.
- Runtime: AI SDK v7 requires ESM and Node.js 22+. The project declares `"type": "module"`, and Vercel Functions use `nodejs22.x`.
- OpenAI routing: `src/server/openai.ts` owns the provider (`createOpenAI`, reading `OPENAI_API_KEY` at request time; a missing key is a classified configuration error) and `resolveTranslateConfig`: `TRANSLATE_MODEL`, `TRANSLATE_REASONING` (`none`|`low`|`medium`, default `none`) and `TRANSLATE_SERVICE_TIER` (`default`|`fast`, default `fast`; Fast is OpenAI priority processing at 2× price, and OpenAI silently serves Standard when Fast is unavailable, reported in `providerMetadata.openai.serviceTier`). The app never sends a fallback model and sets `maxRetries: 0` so a paid retry requires explicit user action. OpenAI reports exhausted credit as 429 `insufficient_quota`, classified as `budget`, not rate limiting. Vercel AI Gateway is no longer used (app or evals).
- Caching and provider options: OpenAI prompt caching uses `promptCacheKey` and `promptCacheOptions: { mode: 'explicit', ttl: '30m' }`; the stable final-user reminder ends with an explicit breakpoint and all live source/context/refinement content follows in a separate text part. Every request sends `reasoningEffort`, `serviceTier` and `store: false`. Hidden reasoning cost seconds of TTFT and billed tokens on every model tried, so `none` is the default; `gpt-6.1-sol` has no `none` effort (minimum `low`). The in-memory LRU key includes model, reasoning and tier.
- Langfuse is optional and activates only when both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` exist. It uses AI SDK v7's `telemetry` option and `@langfuse/vercel-ai-sdk`, with `recordInputs: false`, `recordOutputs: false`, and an explicit safe `runtimeContext` allowlist. Source text, context, refinements, prompts, outputs, raw bodies, and provider metadata must never be added to telemetry. Configure environment/release through `LANGFUSE_TRACING_ENVIRONMENT` and `LANGFUSE_RELEASE`; serverless requests force-flush after native spans end. Telemetry failures remain non-fatal. Local LRU hits do not call AI SDK and create no Langfuse trace.
- Billing: OpenAI is authoritative for billed usage and cost (paid from the monthly OpenAI credit). The application does not normalize usage or calculate cost; Langfuse may show its own estimate when its model catalog recognizes the selected model. Evals estimate cost from token usage with `evals/pricing.ts` (Standard list prices, Fast ×2); update it when prices or models change.
- Client debounce is 800ms, shortened to 400ms (`debounceFor`) when the raw text ends in sentence-final punctuation or an emoji (optionally followed by closing quotes/brackets); a trailing space/newline or partial Korean jamo keeps 800ms so mid-sentence pauses don't fire early. Input changes abort the in-flight run, and the Vercel function sets `supportsCancellation: true` (`vite.config.ts`) so that abort reaches OpenAI instead of the superseded request generating to completion and billing. `useTranslate` also calls the free `warmTranslation` server function (no OpenAI request) on `focusin`/`visibilitychange`, at most once per 2 minutes, so a cold function instance (~1s) boots before the user submits. Paste skips the debounce (`queueImmediate`) and blur flushes a pending run (`flush`). Enter and Shift+Enter always insert a newline, including while a translation is pending; Cmd/Ctrl+Enter force-runs.
- Refine + context: `TranslateInput` carries optional `context` (sentence + word), `refinements` + `previousMain` (sentence only, max 3 refinements of which at most one is free-text). They are injected only into the FINAL user message as `<context>`/`<adjustments>` blocks; the explaining system lines are UNCONDITIONAL so the prefix cache stays intact — keep them that way. Refine chips are toggles (`aria-pressed`); toggling one off removes that adjustment and re-runs (LRU makes it cheap). A failed refine rolls back via an internal snapshot stack (no user-facing undo control). Editing the input clears refinements; context is sessionStorage-sticky. All live text (source, context, refinements, previousMain) passes through `liveText` in `prompts.ts`, which turns pasted `<source>`/`<context>`/`<adjustments>` tags into look-alike `‹…›` quotes so they cannot forge block boundaries (a fake `</source>` previously made the model drop the text before it). The data-not-instructions lines also require covering ALL source text, including markup- or instruction-like parts, because models otherwise silently drop injected lines. `detailGuidance` carries CHARACTER ACCURACY (hanja only for Sino-Korean words, never invented for native words) and GRAMMAR ACCURACY (vowel harmony, adnominal tense, ending vs particle, exact conjugated grammarHighlights) rules; their examples deliberately avoid the eval cases.

## Contextual learning (A)

- `SentenceResult.learningPhrases` carries exact quotes, glosses, counterpart `sourceTexts`, base forms, literal/natural meanings, grammar, omissions, usage notes and character origins in the INITIAL translation request. All response fields remain required for strict structured output; inapplicable facts use empty strings. `grammarHighlights` quotes only noteworthy endings, conjugations or grammatical constructions inside each phrase, with empty arrays for ordinary vocabulary. Prefer one to three useful points per sentence, never underlining every word. `prepareLearningResult` resolves ordered, grapheme-safe exact ranges for phrases, counterparts and grammar annotations. Ambiguous or invalid annotations stay unmarked; an annotation requires a grammar explanation. No model-counted offsets.
- Phrase inspection is local page state only. The separate learning server function, generation module, More detail button, loading/retry path and enrichment caches are removed. Phrase taps and breakdown buttons reveal the initial response; they never issue an LLM request, including for older or incomplete maps. Older gloss-only page-memory results stay readable without inferred underlines. One `LearningProvider` owns selection and invalidates edits/settings/refinements/Clear/errors/pagehide. Never persist source, output or analysis in storage/logs/telemetry. The translation LRU remains the only server result cache.
- Keep `main` before the phrase details in the JSON schema and prompt. Copy still enables when the current main string closes, while rich phrase details and other metadata continue streaming. Inspectable details, Listen and Refine retain their whole-result/current-request guards. Bump `CACHE_VERSION` after response-contract changes so earlier gloss-only results miss the cache.
- Learning follows the non-fluent language: when the reported target equals the UI language and the reported source differs, analyse the original source; otherwise analyse the target (including same-language polishing). `learningSide` selects this deterministically, matching the detail prompts. `learningPhrases.text` quotes that side in order; `sourceTexts` quotes the opposite side despite its legacy name. `LearningInput.side` selects the primary text for sentence ranges and exact UTF-16 validation; omitted side retains legacy target semantics. `sourceSpans` correspond to the opposite text and may reorder or be absent. Validate exact slices, grapheme boundaries and nonoverlapping primary ranges; incomplete coverage is indicated. Input limits are 4,000 source and 16,000 target characters. A learning-only error keeps translation actions usable.
- `InspectableTranslation` preserves plain text and native selection. A short stationary single gesture can inspect a target offset, after a 400ms selection grace period; drag, long press and double-click do not inspect. The 44px inspector chunk buttons provide keyboard access. On desktop, when learning the original source, the target stays plain and non-tappable; use the prepared reference rows. Mobile target taps open the source learning view. The source textarea remains a native editor. A short stationary primary-pointer tap within a prepared source grammar underline opens its owning phrase after the same 400ms selection grace period. Plain source text, drag, double-click, long press, noncollapsed selection and subsequent typing/navigation/scroll/blur retain editing behavior and cancel pending inspection. Hit-test the synchronized mirror’s visible underline rectangles without adding an intercepting overlay or preventing native pointer defaults. `SourceHighlight` uses the selected primary range for source learning and opposite-side spans for target learning. It also renders prepared grammar underlines when learning the original source, before phrase selection. The selected range uses its background highlight without another underline. It is an inert synchronized mirror; source inspection listens on the textarea and tracks the matching pointer through release even when keyboard focus reflows the pane. Desktop phrase inspection leaves source focus in place. Retain the same textarea node, cursor, wrapping and scroll.
- Breakdown is a continuous list across the whole message, never sentence pagination. Selecting a row expands its details inline with `aria-expanded`; the remaining rows stay visible. One phrase is expanded at a time and the same source/main highlights follow it. There is no separate Learning tips UI or response object: grammar, vocabulary/cultural nuance (`usageNote`) and useful CJK `characters` belong to their owning phrase. Word results keep grammar, usage `notes` and character origins inside the dictionary entry. Every generated field is required; empty strings/arrays mean inapplicable. Page-memory compatibility can fill missing older fields without discarding existing rich details.
- Desktop workspace reuses source-side reference for phrase inspection and dictionary data. On mobile (stack/split/laptop/book), tapping the translation opens a full-size learning reading surface with Close/Escape, independent scrolling and the original Copy/Listen dock at its bottom. There is no mobile Breakdown button, minimize control or automatic keyboard/short-height minimization. Background header/source/result controls are hidden or inert; closing restores focus to the translated word or main text, or restores the exact source caret/direction/scroll when opened from a source underline. Keep the same textarea and action nodes mounted. Hide the background reference while the mobile reading surface is open so learner data occurs once.
- Mobile text taps can inspect any meaningful phrase, including ordinary words without grammar underlines. Only grammar annotations are underlined. When learning the original source, a target tap maps through counterpart spans when possible, otherwise opens the source overview. Desktop retains sparse grammar hit targets and a plain fluent target when learning source. Drag, double click and long press retain native selection; a single stationary gesture waits the existing selection grace period. Keyboard Enter/Space opens mobile learning from the main text.
- Desktop source is flat and transparent, 20px body text. The reply/count footer is quieter at 14px, retaining 44px actions. A single closing rule under the whole composer becomes violet on focus; no rule between source and footer. Reference starts after 32px whitespace (less at short heights), with smaller phrase/gloss typography, no row rules, and inline selected details. Keep alternative-row separators.
- Refinements live beside Tone in the header, separated by an **Adjust** label/divider. Show chips directly only when their measured width fits; otherwise use an Adjust disclosure with active summary/dot. Keep one mounted RefineRow so drafts/focus survive width changes. Close the full mobile learning view to return to Adjust and the editor. Adjust uses an anchored floating panel in desktop, mobile portrait and split layouts, with no header height reservation and constrained to avoid Copy/Listen. Only the dedicated tight-keyboard Custom editor reserves header space; other panels wrap chips; short heights use a scrolling chip row or the Custom editor alone. A tight keyboard retains only the Custom input with 44px Apply/Close. Close preserves the draft and returns source focus. Outside dismissal runs after click actions so panel reflow cannot swallow Copy. Caps, current-result guards and rollback remain. UI language is under **Settings**. Alternatives remain open with their own explanations and Copy/Listen. Portrait Paste/Clear remain text-labelled beneath the multiline editor. In narrow split/book panes, source Paste/Clear/reply context share a persistent bottom baseline with the target Copy/Listen dock, with editor and reference content above. Preserve the same source/action nodes, safe-area padding and the matching SSR first paint.
- Stable selectors: `learning-inspector`, `learning-panel`, `learning-chunk`, `selected-phrase`, `source-highlight`, `adjust-button`, `settings-button`. Open Adjust before interacting with refine chips when the header is compact; open Settings before changing UI language. Phrase inspection has no request transport; browser fixtures still alias speech and translation boundaries to prevent paid calls.
- Word results automatically show their existing dictionary in workspace/split/book reference panes, without moving source focus. The target word stays neutral and unadorned when that reference is already visible. Clicking/keyboard-activating `[data-testid="word-details-trigger"]` focuses and scrolls that reference on every activation, with a highlighted dictionary heading; compact layouts open it on demand and restore the word trigger on close. No separate Word details row and no learning generation.
- Exact quotations and phrase order disambiguate repeated primary text. If an overlapping or out-of-order quote makes the full sequence impossible, retain only uniquely matched, disjoint quotes in source order and mark incomplete coverage; never discard independent valid details or choose an arbitrary repeated match. Ambiguous/missing counterpart quotes produce no source highlight. Grammar annotations resolve only unique exact slices within their parent phrase, preserving grapheme boundaries, ordering and nonoverlap. Keep native selection and double-click/long-press behavior intact.
- Underline only prepared grammar-highlight spans, never all phrase spans, the whole sentence or punctuation-only tokens. Ordinary vocabulary stays plain; its full details remain available from the phrase rows and mobile text taps. The word-details trigger retains its separate dictionary affordance. The selected phrase has a background highlight without an additional underline. Punctuation-only analysis rows are omitted without changing the original chunk selection indices. Keep native selection intact. Do not restore helper paragraphs explaining tapping/Breakdown. Keep Adjust with Tone in the header, use spacing above Alternatives; keep separators between alternative rows only.
- There is no Breakdown button in any layout, including streaming and legacy results. Desktop shows prepared reference rows; mobile opens learning from the text. The initial response already contains the complete phrase facts, so there are no enrichment buttons, loading skeletons or paid learning retries. Screenshot helpers must exclude infinite pulse animations when waiting for transitions.

## Pronunciation and result transitions

- `src/server/speech.ts` is the thin server-function boundary; it dynamically imports `speech.server.ts`. Keep provider code server-only. That module uses `generateSpeech` with `maxRetries: 0` and explicit `telemetry.isEnabled: false` so globally registered translation telemetry cannot record speech. It validates WAV framing/format, discards metadata, and delivers PCM chunks after generation completes.
- `SPEECH_MODEL` chooses one exact OpenAI speech model (default `gpt-4o-mini-tts`; legacy `openai/` prefix stripped). `SPEECH_VOICE` is optional (default `marin`). OpenAI speech has no language parameter, so `speechInstructions` names the language in the voice instructions (gpt-4o-mini-tts and newer; `tts-1`/`tts-1-hd` do not support instructions). Change deployment env, redeploy, and reload to switch. No fallback or automatic retry. Swaps must support `generateSpeech` with mono PCM16 WAV output (8–48 kHz).
- `useSpeech` unlocks Web Audio synchronously on tap, streams through `PcmPlayer`, stops on edits/settings changes/unmount/pagehide, and caches only completed audio in a bounded page-memory LRU. Preserve the layout-effect reset: passive cleanup can cancel an immediate tap on a newly completed result.
- Speech limits: 4,000 input characters, 8 MiB audio, 90-second server timeout. Never log source text, raw provider errors, or audio; speech does not register telemetry. `aiSdkWarnings.server.ts` installs a permanent process-wide SDK warning suppression policy because provider warnings have no per-call warning hook; do not temporarily toggle it around requests.
- Main and alternative Copy/Listen controls render their real, static content during loading; do not replace known buttons or refinement chips with skeletons. Copy enables when the current main string is complete; Listen and Refine remain disabled until the whole current non-error result completes. Both Listen surfaces use the same language, stale/pending guard, and settings reset key. `useSpeech` shares one active playback owner across controls, so starting another voice cancels the previous loading/playing request. Keep owner cleanup guarded by identity. Result `ViewTransition` updates are scheduled at completion/error; run initialization and token deltas stay urgent to preserve live-result provenance. Respect reduced motion.

## Streaming presentation

- `useStreamingText` interpolates provider bursts on grapheme boundaries for at most 100ms per burst. It changes only displayed main text, never the live result, Copy text/readiness, request identity or server behavior. Flush when main closes, on completion, result focus/pointer selection and returning to a visible tab. New request identities cancel old frames. Reduced motion shows live text directly. Preserve native selection and urgent stream updates.
- Main text uses normal wrapping; never pretty/balanced wrapping during or after streaming. The cursor occupies zero inline width and stops once main is ready; hide it for reduced motion. Supporting details fade in for 160ms with no height animation and no animation under reduced motion. Known controls remain mounted with their real content.
- The main explanation is secondary 14px/1.5 type, a 12px gap below the main, with a 64ch maximum and a permanent two-line minimum when present. Two neutral placeholder lines reserve that measure while waiting; one-line explanations keep the minimum so following content does not jump upward. Longer explanations grow naturally. Infinite skeleton animations must be excluded from screenshot settling waits.

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

**Narrow panels collapse the bar.** The language group is a CSS query container: source chips expand at 320px, target chips at 280px of actual bar width after toolbar actions. All chip candidates render in SSR and hydration; below those widths CSS hides inactive chips, leaving the SELECTED chip plus `More…` visible. ResizeObserver only keeps the portalled listbox options synchronized with the visible chips; do not use it to gate rendering the buttons. A selected non-fixed language becomes the recent chip immediately. Other languages (including `auto` for the source bar) remain available in the collapsed listbox. This also handles split windows and folded displays. Automation should check whether a chip is visible and otherwise use `lang-more-trigger` + `select-option`, rather than assuming DOM presence or viewport width guarantees a visible chip.

**Optional fold layouts.** With Safari's Device Posture and Viewport Segments feature flags enabled, book posture places source and result in separate horizontal segments. Laptop posture places the result above the fold and input below it; `useFoldLayout` measures the header offset so the boundary matches the physical fold. Unsupported browsers keep the standard responsive layout. These layouts use CSS feature queries, never device-name detection.

### Workspace layout

`TranslatorWorkspace` owns the shell and shares `useWorkspaceLayout` through
`WorkspaceLayoutContext`. A's desktop `workspace` mode starts at 1100px of usable
width: source on the left, result on the right, with one result reading column.
The desktop shell is centered at a maximum of 1536px, with excess width outside
the paired panes. Tone starts at the result reading edge; Adjust and Settings
share that header column without moving Tone when Adjust is absent.
Option 1 sizes the source editor to content (capped for long text). On wide panes,
Paste/Clear mirror Copy/Listen at the end of the language header; reply context
and count remain below the editor. Narrow panes retain the source footer actions.
The desktop editor has no lighter fill or rounded box: source text aligns with
the language row, with a neutral bottom hairline and an inset violet focus line.
Keep the same textarea and synchronized highlight geometry. Compact editor
surfaces keep their existing treatment.
A separately scrollable
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

Before the first layout measurement, `data-layout-pending` keeps SSR and initial
hydration markup identical while CSS chooses the responsive pane arrangement.
The `workspace-viewport` query container excludes side safe areas; its panels
expand back to full viewport width so backgrounds still reach the edges.
Startup container queries match the hook's usable-width breakpoints and are
disabled for physical folds. Do not restore a compact-only first paint, hide
the page until mount, or read the browser viewport during the hydration render.
Browser tests compare raw server markup with hydrated geometry, including
nonzero safe areas and breakpoint edges, and reject hydration errors.

Saved source/target, tone, UI language and recent language shortcuts share
`PreferencesContext`. The root loader reads the validated `nt.preferences`
cookie per request, and uses that same serialized snapshot during hydration.
Keep document and preference responses `private, no-store`, varying HTML on
`Cookie, Accept-Language`. Never put source text, reply context or generated
content in this cookie. Settings actions synchronously update the cookie and
the legacy localStorage keys, so an immediate reload preserves the choice.
The self-contained head bootstrap migrates older localStorage preferences with
one replacement navigation before the app starts; verify cookie writes and
retain its loop guard. Its compiled function must not reference module-scoped
helpers. Do not restore default-first preference effects or client-only render
initializers. Browser tests cover saved snapshots before/after hydration and
immediate tone persistence; unit tests cover validation, legacy migration,
blocked cookies and StrictMode effect replay.

Desktop reference details stay open in a single reading column.
Workspace places interactive breakdown and dictionary data under source, and
general Learning tips below the output alternatives. Split and physical book
layouts retain the combined notes under source; output retains main translation,
actions/refinements and always-open alternatives.
Split/book notes collapse at short visible heights and stay in the same pane
when the keyboard opens. Mobile learning uses a full-size reading view above the original action dock. `SentenceView` and `WordView` select `all`,
`alternatives` or `reference` content, avoiding duplicate metadata. Dictionary
metadata and synonym lookup live in reference content. POS appears there once,
never in the Copy/Listen action group. Desktop Copy contains its shortcut hint. The target scroll surface has no focus ring;
buttons, menus and selects retain visible keyboard focus.

Main result text is `[data-testid="main-translation"]`, its scroll surface is
`[data-testid="translation-result"]`, and its persistent Copy/Listen group is
`[data-testid="output-toolbar"]`, outside generated result content. Adjust remains
in the app header. Main Copy is enabled once its JSON string is complete,
even while details stream, and remains disabled for stale results/settings debounce.
`LiveResult.requestKey` captures the
request settings in page memory; `resultIsCurrent` guards main/alternative actions
and the keyboard shortcut. Source Paste/Clear suppress blur flushing for a draft
being discarded. The source language header hides in short stacked layouts. Both source actions remain visible and labelled on empty and filled input.

Mobile source editing starts expanded and stays expanded during typing and completion. The full-width 18px textarea auto-grows for multiline text, with labelled Paste/Clear in a single row underneath. There is no source collapse/expand control; keep the editor expanded with or without the keyboard. Preserve the same textarea node, cursor and focus as results stream. Keyboard layouts keep at least two editable source lines and sticky actions; short stacked windows hide the target-language row when needed to keep main text tappable. Reply context remains available from the row's labelled accessible icon. Phone result
Copy/Listen controls use 44px icon targets with accessible names/tooltips;
wide result panes (at least 600px) retain labels in a reserved target-header slot.
Compact panes dock the same controls below result/learning and above the composer;
never cover scroll content. Speech error feedback appears above the compact dock.
Keep these real controls mounted, disabled in empty/error/stale states, and keep
the composer inset from safe-area edges. Reserve the header adjustment slot even
before a sentence exists, so Tone/Settings do not jump when Adjust appears.

Use A's background/surface tokens and type scale. Do not restore the obsolete C
desktop top-composer card, word/action grid or two-column learner layout. Workspace
textarea auto-grows to its capped content height; mobile layouts auto-size their expanded multiline source and condense only on explicit user action. Keep at least two lines editable while the keyboard is open. Paste uses tonal violet, keeping Copy strongest.
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
- Browser matrix: `npm run test:browser` (Chromium/WebKit at nine folded/unfolded phone, iPhone and MacBook sizes, synthetic speech; no paid calls). Browser fixtures wait for CSS and use the system-font fallback to avoid external font CDN startup/screenshot races. Production bundles pinned Pretendard font-face CSS with optional display; font subsets keep their original CDN URLs and OFL license. Slow connections must not trigger a late font swap.
- Replay report: `npm run test:browser:report` (serves `test-results/browser/index.html`)
- Interactive browser tests: `npm run test:browser:ui`
- Translation smoke test: `npx tsx scripts/smoke-translate.mjs` (real, billed OpenAI requests; prints the served `serviceTier`)
- Inline-learning smoke test: `DOTENV_CONFIG_PATH=.env.local npx tsx scripts/smoke-inline-learning.mjs` (one real, potentially billed translation; prints aggregate schema/grammar checks and main-copy versus full-completion timing, with no generated content or retries)
- Speech smoke test: `npx tsx scripts/smoke-speech.mjs` (one real, potentially billed request; optional output WAV path argument; `DOTENV_CONFIG_PATH` selects local credentials)
- Quality eval (promptfoo, billed): `npm run eval:quality` compares the variants (OpenAI model + reasoning effort + service tier) in `evals/promptfooconfig.yaml`, running the production `translationRequest` on the synthetic `evals/cases.yaml` (weighted to the real EN↔KO use: reading Korean news/healthcare/coworker text, writing natural Korean to coworkers/friends/partner, Korean grammar learning, Korean-UI English learning; `situation` is judge-only) and `evals/injection.yaml` (prompt-injection cases that must be translated, never obeyed). Each output gets deterministic `checks` (`evals/checks.ts`), blind `translation`/`explanations` rubric scores (`evals/rubrics.ts`, judge `openai:responses:gpt-6.1-sol`) (no select-best: promptfoo presents variants in config order and the judge favoured the first, so `npm run eval:summary` ranks variants from these scores with ties split). Translations and judge calls are cached by full request (prompt, schema, model, reasoning, repeat index), so adding a variant or rerunning only pays for new calls; `eval:quality:fresh` bypasses the cache (run one eval at a time: concurrent runs share promptfoo's single judge-cache file and can overwrite each other's new entries), `eval:quality:repeat` runs 3 repeats before trusting small differences, `eval:injection` runs only injection cases, `eval:progress` reports a running eval, `eval:summary` prints the per-variant table and `eval:view` opens the results grid. Requires `OPENAI_API_KEY` in `.env.local`; translations and the judge (`openai:responses:gpt-6.1-sol`, low reasoning) are paid from the OpenAI credit. The judge shares a model family with the candidates (and is the sol variant), so read small sol leads with care; scores before 2026-10-30 came from Claude Sonnet and are not comparable. Translation responses are cached one file per request in `.promptfoo-cache/translations` (promptfoo's single-file cache lost entries to the CLI's own cache instance). CI: `.github/workflows/translation-eval.yml` runs `evals/ci.promptfooconfig.yaml` (production config only; keep it in sync with production `TRANSLATE_MODEL`/`TRANSLATE_REASONING`/`TRANSLATE_SERVICE_TIER`) on PRs touching the model-facing request or evals, and on demand, failing only when the suite pass rate drops below 60% (terra passes 66–76%, the old luna setup 34–42%; per-case judge failures are expected); needs the `OPENAI_API_KEY` repository secret. Cases must stay synthetic, never real user text.
- Vercel: `vercel.json` runs `npm ci` followed by `npm run build`, using the committed npm lockfile.

Folded keyboard editing uses a flat source surface with labelled Paste/Clear/Context actions. There is no source collapse control; keep the same expanded multiline textarea and its focus.
