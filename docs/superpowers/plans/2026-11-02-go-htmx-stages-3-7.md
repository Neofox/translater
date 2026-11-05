# Go + htmx rewrite: Stages 3–7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is one reviewer gate.

**Goal:** Bring the Go + htmx app to full feature and visual parity with the TypeScript app: word mode and dictionary, contextual learning, pronunciation, refine/context/settings, and every layout. Then deploy it to production on Vercel (project `translater-go`), publish the final TS-vs-Go performance report, and sign off parity with the full black-box suite green on both apps across all 18 Playwright projects, plus TS-vs-Go screenshot comparison at the nine viewports.

**Architecture:** This continues the stage 0–2 architecture without changes. One streaming `POST /translate` per run, answered with `text/event-stream`. The htmx 4.0.1 core and the `hx-sse` extension apply unnamed `<hx-partial>` swaps and turn named `nt-*` events into DOM events on `#translate-form`, where `event.detail.data` is a raw JSON string. The server owns parsing, validation, learning-range resolution and HTML rendering (templ). The client owns only irreducible browser work: text interpolation, Copy, gestures, the Web Audio player, viewport/keyboard measurement and popover positioning. All of it is small delegated ES modules, and the source textarea is never inside a swap target. The server stores nothing per user except the result LRU. Per-session state (refinement stack, reply context, learning selection, audio replay cache) lives in page memory or sessionStorage.

**Tech Stack:**
- Go 1.27: `net/http`, `encoding/json/v2`, `unicode/utf16`.
- Go libraries: `github.com/openai/openai-go/v3` (Responses plus `Audio.Speech`), `github.com/a-h/templ`, `github.com/hashicorp/golang-lru/v2`, `github.com/santhosh-tekuri/jsonschema/v6`, `github.com/rivo/uniseg` (UAX #29 graphemes), `go.opentelemetry.io/otel` + `go.opentelemetry.io/otel/sdk/trace` + `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp` (Langfuse via OTLP), `golang.org/x/net/html` (markup-parity tests), `github.com/google/go-cmp`, and `github.com/tdewolff/minify/v2`, only if the JS budget needs minification.
- Browser and tooling: htmx 4.0.1 + `hx-sse` (self-hosted), Tailwind v4 standalone CLI 4.3.3, `lucide-static` (pinned to the `lucide-react` version, 1.61.0), Playwright 1.64.1 (`toHaveScreenshot`, `toMatchAriaSnapshot`, CDP sessions), Chrome DevTools MCP for traces, Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-11-02-go-htmx-rewrite-design.md` (binding). The stage 0–2 plan (`docs/superpowers/plans/2026-11-02-go-htmx-stages-0-2.md`, Tasks 1–13) defines the interfaces used here. The stage-2 gate is a checkpoint, not a stop: these tasks proceed after Task 13's report.

---

## Global Constraints

Carried over from stages 0–2 (unchanged):

- `go.mod`: `go 1.27`. Use current APIs (`encoding/json/v2`, `iter.Seq2`, `ServeMux` method patterns). Confirm details with context7 (`/golang/go/go1.27.3`, `/golang/website`), never from memory.
- htmx **4.0.1**, self-hosted under `go/web/static/vendor/`, together with the **`hx-sse` extension**. Core alone does not parse `text/event-stream` (stage 0). Named SSE events arrive on the form element (`#translate-form`), and `event.detail.data` is a raw JSON string (`JSON.parse` it). Follow the htmx 4 docs (`/bigskysoftware/htmx/v4.0.0`, https://four.htmx.org). Never copy htmx 2 examples.
- **Prefer maintained third-party libraries over custom code** (user instruction). Hand-written modules say why in their doc comment.
- No change to model, reasoning, tier, prompt content, schema or few-shots. Prompts, schemas and strings live in `shared/translation/` (Mustache). Go copies them with `go generate` (`cmd/syncshared`), and CI fails when the copy is stale. Golden request bodies must keep matching.
- Same env vars and defaults: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (tests), `TRANSLATE_MODEL` (default `gpt-6.1-terra`, `^[a-z0-9][a-z0-9._-]*$`i), `TRANSLATE_REASONING` (`none|low|medium`, default `none`), `TRANSLATE_SERVICE_TIER` (`default|fast`, default `fast`).
- **No legacy or dead code paths** (user decision): no localStorage preference migration, no `openai/` prefix stripping (for `TRANSLATE_MODEL` or `SPEECH_MODEL`), no older result shapes, no unused fields.
- Zero retries (`option.WithMaxRetries(0)`), `store:false`, no fallback model, no speculative paid work (no audio pre-generation, no learning requests).
- Limits (`shared/translation/limits.json`): source 4,000 chars (warn at 80% = 3,200), context 1,000, ≤ 3 refinements of ≤ 200 chars each, learning translation 16,000. **Character counts are JS `.length` (UTF-16 code units)**. Go counts with `utf16.RuneLen` summed over runes, never `len()` or rune count.
- Client debounce: 800 ms, or 400 ms when the text ends with sentence-final punctuation or an emoji (the stage-2 regex). Paste and refinement run immediately, blur flushes, Cmd/Ctrl+Enter forces, and Enter/Shift+Enter insert newlines. Warm-up runs at most once per 2 minutes.
- Translation LRU: 50 entries. The key includes cache version, model, reasoning and tier.
- The source textarea is **never** inside a swap target and **never moved, replaced or re-parented**. Main text deltas are inserted as text, never HTML.
- HTML responses: `Cache-Control: private, no-store`, `Vary: Cookie, Accept-Language`. Hashed static assets: `public, max-age=31536000, immutable`.
- Never log, store or send to telemetry: source text, context, refinements, prompts, outputs, audio, raw provider errors.
- Tests never make paid calls. **Billed runs (production smoke, `--live` measurement) have the user's standing go-ahead for this plan**, along with use of the Vercel CLI/API. Still print the billed-request count before each run.
- Client JS budget: **≤ 40 KB gzip in total, including htmx + hx-sse (16,001 B already)**. `make size` (Task 11) is run in **every** task's commit step, and each new module has a byte budget, given below.
- Commands: Go/templ/tailwind via mise in `go/`. The TypeScript side keeps npm.

New for stages 3–7. Exact values come from `AGENTS.md` and the TS source:

- **Same UI.** Every templ component reproduces its TS component's DOM order, element types, class strings (byte-identical utility strings, including `Pill`/`Tag` tone and size maps), `data-testid`s, ARIA attributes and `lang` attributes. The only allowed differences are listed in `go/web/static/css/go.css` / the sign-off report: elements that TS unmounts may be kept mounted with `hidden` or `inert` (hidden elements are absent from the accessibility tree, so ARIA snapshots still match). Every UI task adds its states to `e2e/visual/states.ts` and passes `npm run e2e:visual` for those states (Task 14).
- **All client handlers are delegated** (document- or form-level listeners keyed on `data-testid` / class), so swapped, restored (refine rollback) or moved DOM needs no rebinding.
- **Offsets sent to the browser are UTF-16 code units.** This covers learning ranges, `data-start`, `data-source-start` and every range in `nt-learning`. Graphemes come from `rivo/uniseg`, converted to UTF-16 offsets.
- Learning side: `side = target === uiLang && source !== uiLang ? "source" : "target"`, using the model-reported `sourceLang`/`targetLang`, falling back to the request's languages. Source ranges are computed on the **raw** `text` form value (untrimmed, the exact textarea value). Target ranges are computed on the raw `main` (`primaryTranslation` for words).
- Gestures: an inspect tap requires duration `< 350 ms`, movement `< 8 px`, and no selection. Inspection then waits a **400 ms** grace period, which is cancelled by selection, double-click, pointercancel, keydown, input, compositionstart, scroll, blur, contextmenu, dragstart and pagehide.
- Speech:
  - Input limits: `SPEECH_MODEL` default `gpt-4o-mini-tts` (same model-id regex); `SPEECH_VOICE` default `marin`, trimmed, non-empty, ≤ 200 chars, no control chars (< 32 or 127); input text trimmed, 1–4,000 chars; language ∈ `en, ko, ja, fr, es, zh, auto`.
  - Server limits: audio ≤ 8 MiB (8,388,608 B), with the WAV container allowed up to 8 MiB + 65,536 B; 90 s server timeout; WAV must be mono PCM16, 8,000–48,000 Hz, accepting the `0xFFFFFFFF` streaming RIFF/data sizes.
  - Client player: rate 8,000–96,000 Hz, ≤ 8 MiB.
  - Replay LRU: ≤ 3 entries **and** ≤ 4 MiB (4,194,304 B), completed audio only, keyed `JSON.stringify([text, language])`.
  - Too-long text (> 4,000 chars) shows `speechTooLong` **before** unlocking audio or sending a request.
  - Speech never registers telemetry.
- Refinements:
  - Chip ids and instructions (model-facing, fixed English): `softer` → `make it softer`, `direct` → `make it more direct`, `shorter` → `make it shorter`, `playful` → `make it more playful`. Label keys: `refineSofter`, `refineMoreDirect`, `refineShorter`, `refineMorePlayful`.
  - Caps: max 3, at most one free-text (non-chip) entry. Free-text input `maxLength` 200; the custom label shows the first 20 chars + `…`.
  - Rollback snapshot stack depth `MAX_UNDO = 10`. `previousMain` resets to `''` when the list becomes empty. Editing the input clears refinements.
- Adjust:
  - Inline sizing: icon-only when `root.clientWidth < 112`. Inline when `root.clientWidth >= needed + 2`, where `needed = Σ chip widths + (n−1)·column-gap + label width + 14`.
  - Floating panel: placement bottom-start, fixed, offset 12, shift padding 16, x clamped to `max(16, min(x, actions.left − panelWidth − 12))` when it would overlap `.primary-result-actions`.
  - `--adjust-panel-height = content height + 6px` only when `open && !inline && !overlay`, where `overlay = !inline && !(keyboard && tight)`.
- Settings popover: placement bottom-end, offset 8, flip + shift. Padding `8 + --safe-area-*`, constrained to its `section` in `book|laptop|split|workspace`.
- Layout:
  - Mode thresholds: `workspace` at usable width ≥ 1100; `split` at ≥ 560 when width > natural height; otherwise `stack`. `book` and `laptop` come from `(device-posture: folded) and (horizontal|vertical-viewport-segments: 2)`.
  - Flags: `short` when visible height < 460, `tight` when < 360. Keyboard when `natural.height − visibleHeight > max(100, 0.2 · natural.height)` while editing (touch, or visible < innerHeight − 100). Zoom is ignored when `|scale − 1| > 0.01`.
  - `resultFirst` for `stack|laptop`. The reference pane appears only in `workspace|split|book`.
- Context: sessionStorage key `nt.context`, value `JSON.stringify(string)`.
- Telemetry: Langfuse only when both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are non-blank. Same allowlist as `SAFE_TRANSLATION_CONTEXT_KEYS`. No input/output attributes. Failures are non-fatal and warned once. LRU hits create no trace.

## Review Focus

1. **UTF-8 vs UTF-16 offsets.** Source/target ranges computed on Go strings are byte offsets. The textarea, `Range.toString().length` and JS slicing are UTF-16, so emoji (surrogate pairs), Hangul and combining marks (`e` + U+0301) shift every underline and hit-test after them. Owning tests: Task 18 `TestPrepareOffsetsAreUTF16`, Task 20 e2e `source grammar tap after emoji opens its phrase`.
2. **The textarea node must survive everything new.** Panel reorder at layout changes, opening and closing the mobile learning surface, the reference pane moving the inspector, synonym lookup, Adjust/Custom editor and refine rollback. Moving the wrong node loses focus, caret, IME composition and scroll. Owning tests: Task 27 `layout changes keep the textarea node, caret and focus`, Task 21 `closing learning opened from a source underline restores the exact caret`.
3. **Stale or late work acting on a new result.** Listen tapped on a result that just went stale. Audio arriving after Stop. A new speaker not stopping the old one. `nt-learning` from a superseded run (Vercel cannot cancel it, stage 0). A speech request sent after Stop during audio unlock. Owning tests: Task 23 `stop during slow unlock sends no request`, `another speaker aborts the connecting one`; Task 19 `learning from a superseded run is ignored`.
4. **Refine rollback restores exactly the previous result.** On a failed refine: main, alternatives, learning rows, Copy text, chip states, `previousMain` and hidden form fields all come back. Non-refine errors must not roll back. Owning tests: Task 25 `failed refine rolls back to the previous result with a compact notice`, `a non-refine error does not roll back`.
5. **Overlays swallowing or covering primary actions.** The Adjust floating panel, Custom editor, Settings popover and mobile learning surface. Outside-dismiss must run after the click action so reflow cannot swallow Copy, and the panel must never overlap `.primary-result-actions`. Owning tests: Task 26 `opening Custom with phrase details already open keeps Copy clickable`, `desktop Adjust overlays without growing the header or covering primary actions`.

---

## File structure (additions to stages 0–2)

```
go/
  cmd/syncstyles/               copies src/styles.css + src/styles/pretendard.css → web/static/css (generated)
  cmd/syncicons/                lucide-static SVG → internal/web/icons/icons_gen.go
  cmd/smoke/                    Go equivalents of smoke-translate / smoke-speech (billed, manual)
  internal/learning/            side, ranges (prepareLearningResult port), character origins
  internal/speech/              config, instructions, WAV→PCM, /speech handler
  internal/telemetry/           OTel → Langfuse generation spans, allowlist
  internal/web/icons/           icon component + generated paths
  internal/web/ui/              Pill, Tag (templ)
  internal/web/*.templ          word.templ, dictionary.templ, learning.templ, reference.templ,
                                learningpanel.templ, listen.templ, refine.templ, adjust.templ,
                                context.templ, settings.templ, workspace.templ
  web/static/css/               base.css, pretendard.css (generated), go.css (Go-only, justified rules), input.css
  web/static/js/                dictionary.js, learning.js, inspect.js, pcm.js, speech.js, context.js,
                                float.js, settings.js, refine.js, adjust.js, layout.js, transition.js (+ *.test.js)
e2e/
  tests/                        word.spec.ts, learning.spec.ts, speech.spec.ts, context.spec.ts,
                                refine.spec.ts, layout.spec.ts, visual.spec.ts, prod-smoke.spec.ts (manual)
  visual/states.ts              shared screenshot/ARIA states
  fixtures/results/*.json       new synthetic fixtures (listed per task)
docs/superpowers/reports/       <date>-go-vs-ts-performance.md, <date>-parity-signoff.md
```

JS byte budgets (gzip, measured by `make size`): dictionary.js 0.6 KB, learning.js 2.5 KB, inspect.js 1.5 KB, pcm.js + speech.js 2.5 KB, context.js 0.5 KB, float.js 1.0 KB, settings.js 0.4 KB, refine.js 1.5 KB, adjust.js 1.2 KB, layout.js 2.0 KB, transition.js 0.3 KB, about 14 KB in total. If stage-2 modules plus these exceed 24 KB (40 − 16), enable `tdewolff/minify/v2` in `make assets` before cutting behaviour.

---

## Stage 3: word mode and dictionary reference

### Task 14: UI parity foundation (CSS carry-over, icons, primitives, visual/ARIA harness)

Why first: every later task's "Same UI" step cites this harness.

**Files:**
- Create:
  - `go/cmd/syncstyles/main.go`, `go/web/generate.go` (`//go:generate go run ../cmd/syncstyles`)
  - `go/web/static/css/{base.css,pretendard.css}` (generated), `go/web/static/css/go.css`
  - `go/cmd/syncicons/main.go`, `go/internal/web/icons/{icons.go,icons_gen.go,names.txt}`
  - `go/internal/web/ui/{pill.templ,tag.templ,ui_test.go}`
  - `scripts/capture-ui-markup.tsx`, `go/internal/web/testdata/react-markup.json`
  - `e2e/visual/states.ts`, `e2e/tests/visual.spec.ts`
- Modify:
  - `go/web/static/css/input.css`
  - `go/Makefile` (`generate`, `css`, `icons`, `size`)
  - `e2e/playwright.config.ts`, `e2e/ports.ts`
  - `package.json` (devDependency `lucide-static@1.61.0`, script `e2e:visual`)
  - `.github/workflows/go.yml`

**Interfaces:**
- Produces:
  - `go generate ./...` writes `web/static/css/base.css` = `src/styles.css` minus its two `@import` lines, under a `/* Code generated by syncstyles from src/styles.css. DO NOT EDIT. */` header, and `web/static/css/pretendard.css` = `src/styles/pretendard.css` verbatim. The output is deterministic, and CI checks it is fresh.
  - `input.css`: `@import "./pretendard.css"; @import "tailwindcss" source(none); @source "../../../internal/web/**/*.templ"; @source "../js/**/*.js"; @import "./base.css"; @import "./go.css";`. Verify the `source(none)` / `@source` syntax with context7 (Tailwind v4) before writing. `go.css` holds only Go-specific rules (e.g. `[hidden]` reference/learning panels, native `popover` UA resets), each with a comment naming the TS behaviour it reproduces.
  - `icons.Icon(name string, size int, attrs templ.Attributes) templ.Component`. It emits exactly lucide-react 1.61.0's attribute set: `xmlns`, `width`, `height`, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `class="lucide lucide-<kebab> …"`, plus caller attrs. `names.txt` lists the icons used: clipboard, x, plus, chevron-down, sliders-horizontal, settings, arrow-right-left, rotate-ccw, triangle-alert, loader-circle (Loader2), square, volume-2, reply, copy, check, and any others found by grepping `lucide-react` imports in `src/components`.
  - `ui.Pill(p ui.PillProps) templ.Component` with `type PillProps struct{ Tone string /* neutral|accent|warm|active|primary */; Size string /* sm|md */; Class string; Attrs templ.Attributes }`. The class string is byte-identical to `src/components/ui/Pill.tsx` (`ui-pill inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border transition …`). `ui.Tag(tone string)` matches `Tag.tsx` the same way.
  - Playwright:
    - `snapshotPathTemplate: '../test-results/visual-baseline/{projectName}/{arg}{ext}'`, independent of `APP`.
    - `E2E_TS_BUILD=prod`, which serves the TS **production build** through `e2e/perf/serve-ts.mjs` instead of `vite dev`, so dev overlays and devtools cannot appear in screenshots. `e2e:visual` and the sign-off use it.
    - `npm run e2e:visual` = `E2E_TS_BUILD=prod APP=ts playwright test -c e2e --grep @visual --update-snapshots=all && APP=go playwright test -c e2e --grep @visual`.
  - `e2e/visual/states.ts`: `export type VisualState = { name: string; projects?: RegExp; setup(page: Page, fake: Fake): Promise<void> }` and `export const STATES: VisualState[]`. The initial states are `empty`, `sentence-done` (fixed text `[fx:visual] How are you doing today, my friend?`, new fixture `visual.json`) and `error-provider`. Each later task appends its states.
  - `visual.spec.ts` (`@visual`): for each state, run setup and then `settle(page)` (await `document.fonts.ready`, two animation frames, no transition running; infinite `.animate-pulse` elements are excluded from waits). Then:
    - `await expect(page).toHaveScreenshot(\`${name}.png\`, { animations: 'disabled', caret: 'hide', mask: [page.locator('.animate-pulse, .result-cursor')], threshold: 0.1, maxDiffPixelRatio: 0.001 })`
    - `await expect(page.locator('body')).toMatchAriaSnapshot({ name: \`${name}.aria.yml\` })`

- [ ] **Step 1: Failing tests.**
  - `go test ./internal/web/ui/ ./internal/web/icons/`, test `TestPrimitivesMatchReact`. For each Pill tone × size, each Tag tone and each icon, parse the templ output and `react-markup.json` (written by `npx tsx scripts/capture-ui-markup.tsx` via `react-dom/server` `renderToStaticMarkup`) with `golang.org/x/net/html`. Assert equal tag names, the same attribute sets and identical class token sequences.
  - `TestStylesFresh`: `base.css` equals the transform of `../src/styles.css`.
  - `npm run e2e:visual -- --grep "empty|sentence-done|error-provider"` fails on Go wherever stage-2 markup or CSS differs.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Generators, primitives and harness. Then migrate the existing stage-2 templates to `ui.Pill`/`icons.Icon` and the full CSS. If Task 11 left a partial CSS port, replace it.
- [ ] **Step 4: Run.** `go test ./...`, `make css && git diff --exit-code`, and `npm run e2e:visual -- --grep "empty|sentence-done|error-provider"` all PASS at 9 viewports × 2 engines. Also `make size` stays ≤ 40 KB, and the CSS gzip size is ≤ the TS app's (28.7 KiB, from the baseline report).
- [ ] **Step 5: Commit** (`feat(go): shared styles, icons, primitives and TS-vs-Go visual parity harness`).

### Task 15: Word results and dictionary content

**Files:**
- Create:
  - `go/internal/web/{word.templ,dictionary.templ}`, `go/internal/learning/characters.go` (+ `_test.go`)
  - `go/web/static/js/dictionary.js` (+ `dictionary.test.js`)
  - `e2e/tests/word.spec.ts`
  - `e2e/fixtures/results/{word-hanja.json,word-slow.json}`
- Modify: `go/internal/translate/{handler.go,events.go}`, `go/internal/web/result.templ`, `e2e/visual/states.ts`

**Interfaces:**
- Consumes: stage-2 `jsonstream` events, `AlternativeRow`, `#alternatives`.
- Produces:
  - `learning.IsLearningText(s string) bool`: `[\p{L}\p{N}\p{S}]`.
  - `learning.IsCharacterOrigin(word string, chars []CharNote) bool`: every char is a single `\p{Han}` rune, and Hangul words need exactly one char per Hangul syllable.
  - `web.CharacterLabelKey(word string) string`: `hanja` for U+AC00–D7AF, `kanji` for U+3040–30FF, `hanzi` for U+4E00–9FFF, otherwise `characters`. It checks the first valid note's word.
  - `web.WordMeta(v web.WordMetaView) templ.Component`. Port of `WordSourceMeta.tsx` with the same JSX render order: POS tabs (only when > 1 POS), POS label, Primary meaning (definition, register `Tag`s, `•` examples), Other meanings (same-POS senses numbered from 2, then `(pos)` cross-POS senses), Etymology, Grammar, CharacterNotes, Notes, Synonyms (buttons). While streaming, the first not-ready section in `primary, other, etymology, grammar, notes, characters, synonyms` order shows its skeleton.
  - `type WordMetaView struct{ UILang string; Streaming bool; POS []POSView; Etymology, Notes, Grammar string; Characters []CharNote; Synonyms []string }`.
  - Server: a word accumulator collects completed `posList[i]` and top-level field `ValueEnd`s. After each, it emits `<hx-partial hx-target="#word-meta" hx-swap="innerHTML">` with the re-rendered `WordMeta`. Word alternatives render `AlternativeRow` with register `Tag`s inside `.flex.flex-wrap.items-baseline.gap-2`, exactly as `AlternativeItem.tsx` does with children.
  - `dictionary.js`: POS tab switching (delegated `click` on `.word-source-meta` POS buttons; the active index persists across `#word-meta` swaps within a run and resets to 0 on a new run). Synonym click calls `composer.setText(text, { focus: true })` (a stage-2 composer export; add it if missing). That assigns the same textarea's `value`, clears refinements, focuses it and schedules a normal run.
- [ ] **Step 1: Failing tests.**
  - Go:
    - `TestIsCharacterOrigin`: `학교`+`學`,`校` → true; `사랑`+`思`,`郞`,`亮` → false (count mismatch); a non-Han char → false.
    - `TestCharacterLabelKey`.
    - `TestWordMetaStreamsSections`: the `word.json` fixture via `httptest` yields `#word-meta` partials whose last one contains, in DOM order, the labels POS, Primary meaning, Other meanings, Etymology, Grammar, Notes, Synonyms (STRINGS.en), plus `interjection` and `An expression or feeling of gratitude.`.
    - `TestWordSkeletonForNextPendingSection`: a partial before `etymology` closes contains exactly one skeleton, labelled Etymology.
  - Node: `dictionary.test.js` covers active-index retention and reset.
  - e2e `word.spec.ts` (`@word`, both apps):
    - `word result shows primary translation, register tags and alternatives`: `[fx:word] thanks` → main `고마워`; 3 `alternative-item`; the first row has Tag `casual polite`; the section title is `alternativeTranslations`.
    - `dictionary streams POS, meanings and synonyms` (workspace/split projects): click the `noun` tab → `An expression or feeling of gratitude.` is visible.
    - `synonym starts a new lookup`: click the first synonym → the textarea value equals it, the textarea is focused, `/_stats.requests` +1, and `lastBodies` contains it.
    - `only real character origins are shown` (`word-hanja.json`): label `Hanja`, invalid note absent.
    - `word metadata stays separate from translation actions at every size`: no POS text inside `[data-testid="output-toolbar"]`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Same UI: markup per `WordView.tsx`/`WordSourceMeta.tsx`/`CharacterNotes.tsx`/`AlternativeItem.tsx`. Add visual state `word-done`.
- [ ] **Step 4: Run** `go test ./...`, `node --test go/web/static/js/`, `APP=go` and `APP=ts` `--grep @word`, and `npm run e2e:visual -- --grep word-done` → PASS. `make size` passes.
- [ ] **Step 5: Commit** (`feat(go): word results and dictionary content`).

### Task 16: Result pane completeness (stage-2 gaps found in the TS source)

**Files:**
- Create: `go/internal/prompt/longform.go` (+ `_test.go`), `go/web/static/js/transition.js`, `e2e/fixtures/results/longform.json`
- Modify: `go/internal/translate/events.go`, `go/internal/web/{result.templ,header.templ}`, `go/web/static/js/{stream.js,composer.js}`, `e2e/tests/core.spec.ts`, `e2e/visual/states.ts`

**Interfaces:**
- Produces:
  - `prompt.IsLongForm(text string) bool`. Port of `src/lib/longForm.ts`: trimmed text that is non-empty and contains `\n`, or has UTF-16 length > 200, or has ≥ 2 matches of `[.!?。！？…]['")\]]?\s+\S`. When true, the server emits no alternative partials (`hideAlternatives`).
  - Alternative skeleton: on the first event under `alternatives[i]` / `alternativeTranslations[i]`, emit `AlternativeSkeleton` (the `AlternativeItemSkeleton.tsx` markup with real, disabled Copy/Listen). On that item's `ValueEnd`, swap it for the row.
  - Main explanation (`MainExplanation.tsx`):
    - `section.main-explanation.detail-why[aria-label]` with an `sr-only` h3 (`whyWording` / `usage`).
    - Two-line skeleton while waiting.
    - Register label `span.section-tag[lang=ko]` showing `반말`/`해요체`/`존댓말` for friends/casual/professional when the sentence target is `ko`.
  - Errors: `.result-error[role=alert]` with TriangleAlert 28, `state-title` `translationFailedTitle`, `state-body` message, the `errorEnvHint` line, and a Retry `Pill` (accent, md, `.retry-button`, RotateCcw 18) on every server error (TS `kind:'server'`). Retry triggers a `force` run. Input over 4,000 chars is checked on the client: no request, message `inputTooLong`, hint `inputTooLongHint` with `{max}`/`{count}`, no Retry.
  - `section.output-panel[aria-busy]` reflects streaming. `span.sr-only[role=status]` shows `polishing` or `streaming`. The swap button `.swap-button` shows ArrowRightLeft (or `Loader2 animate-spin` while streaming). Its rule: if the result is done and current with main text, then `input := main`, source `auto`, target := `source==auto ? detected ?? en : source`; otherwise a plain swap.
  - Empty state: `.result-empty > p` (`emptyMain`). Placeholder `…` / `.result-cursor.animate-pulse` exactly as `OutputPanel.tsx`.
  - `transition.js` (budget 0.3 KB): wraps only the completion/error DOM update in `document.startViewTransition` (result element `view-transition-class: result-transition` from base.css). It is skipped under `prefers-reduced-motion: reduce` or when unsupported. Deltas never run inside a transition.
  - Verify stage 2 delivered these, adding any that are missing: Mode `<select class="mode-select">` fallback; Copy shortcut hint (desktop); `div.tight-learning-slot[data-testid=tight-learning-slot]`; `result-word` class on word main; Paste `tone=primary`, Clear neutral, both with `data-input-action` and pointerdown `preventDefault`.
- [ ] **Step 1: Failing tests.**
  - Go: `TestIsLongForm` (cases: `"Hi.\nThere"`, 201 chars, `"Mr. Smith arrived. He sat. Done."` → true, `"wait... what"` → false); `TestLongFormNoAlternatives`; `TestAlternativeSkeletonThenRow`.
  - e2e (`@core`):
    - `long-form input hides alternatives`.
    - `retry re-runs a failed translation`: error-provider fixture → Retry → `/_stats.requests` +1.
    - `swap uses the translated text when the result is current`.
    - `register label names the Korean speech level`: casual → `해요체`.
    - `streaming deltas stay urgent and only completion starts a result transition`: count `document.startViewTransition` calls via an init-script spy, = 1 per completed run, 0 under reduced motion.
    - `input over the limit shows a local error without a request`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. Same UI: add visual states `streaming-skeleton` (slow fixture, masked pulse) and `error-input`. `make size` passes.
- [ ] **Step 5: Commit** (`feat(go): result pane parity: long form, skeletons, retry, swap, transitions`).

### Task 17: Reference pane, word-details trigger, compact learning surface shell

**Files:**
- Create: `go/internal/web/{reference.templ,learningpanel.templ}`, `go/web/static/js/learning.js` (word part; budget shared with Task 19)
- Modify: `go/internal/web/{workspace.templ,result.templ}`, `go/internal/translate/events.go`, `e2e/tests/word.spec.ts`, `e2e/visual/states.ts`

**Interfaces:**
- Produces:
  - Reference pane: `section.reference-panel[aria-label=notes][data-word-active]` containing `div.reference-scroll.scrollbar-thin[tabindex=0][aria-label=notes]`, then `h2.reference-heading[tabindex=-1]`, then `#learning-inspector` (`.learning-inspector[data-testid=learning-inspector]`). It is rendered inside `.input-panel` after `.composer`.
    - Go keeps it mounted and sets `hidden` when TS would unmount it: layout not in `workspace|split|book`, or the mobile learning surface open in a non-desktop layout, or no live result, or an error, or a sentence without prepared learning.
    - Heading: `wordDetails · <headword>` when word details are active; otherwise desktop `wordDetails` (word) / `breakdown` (sentence); otherwise `learn`.
  - Word inspector content: `section[aria-label=wordDetails] > #word-meta` (Task 15).
  - Word main: the run-start partial `<hx-partial hx-target="#main-translation" hx-swap="innerHTML">` renders, for word intent, `button.word-details-trigger[data-testid=word-details-trigger][aria-label="Word details: <main>"][aria-expanded][disabled]`. Its `[data-main-text]` child is the delta target. For sentences, `#main-translation` itself is the delta target. `stream.js` resolves `[data-main-text]` first.
  - Learning surface shell: `section.learning-panel[data-testid=learning-panel][data-expanded][aria-label=learn][hidden]` containing `.learning-panel-header` (`h2` `learn` or `learn · <phrase>`, close Pill md, X 18, `aria-label=closeLearning`) and `.learning-panel-body.scrollbar-thin`. It is rendered at the end of `.output-panel`.
  - `learning.js` (word path), state `{ run, canOpen, open, wordActivation }`. `canOpen` = done ∧ ¬error ∧ main ∧ current request key.
    - Trigger activation (keyboard click with `event.detail === 0`, or pointer via Task 20's gesture once wired; until then a plain click) works like this:
      - In `workspace|split|book`: unhide the reference, set `data-word-active`, set the heading text, focus the heading (`preventScroll`) and scroll `.reference-scroll` to top, **on every activation**.
      - In `stack|laptop`: toggle the learning surface.
    - Open: move `#learning-inspector` into `.learning-panel-body`; set `inert` on `.input-panel`, `.target-toolbar`, `.result-scroll`; focus Close.
    - Close (Close, Escape inside the panel, pagehide, input/settings change, new run, error): move the inspector back, remove `inert`, and focus the word trigger, falling back to `#main-translation`.
    - The trigger's `aria-expanded` is `true` in separate-reference layouts and otherwise mirrors `open`.
- [ ] **Step 1: Failing e2e** (`@word`):
  - `word details trigger focuses the reference on every activation` (workspace/split projects): two activations → heading focused both times, text `Word details · thanks`, `/_stats.requests` unchanged.
  - `compact word details open the learning view and restore the trigger` (stack projects): Escape → panel hidden, trigger focused.
  - `word details trigger is disabled while streaming` (`word-slow.json`).
  - `reference notes track streaming, clear and error without moving source focus`: focus the textarea, stream, Clear, error → `document.activeElement` stays the textarea.
  - `no separate Word details row and no paid request`: zero `.learning-chunk` rows for words.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. Same UI: markup per `ReferencePanel.tsx`, `LearningPanel.tsx`, `InspectableTranslation.tsx` (actionLabel branch). Add visual states `reference-word` (workspace projects) and `learning-word-open` (stack projects).
- [ ] **Step 5: Commit** (`feat(go): reference pane, word details trigger, compact learning shell`).

---

## Stage 4: contextual learning

### Task 18: Server-side learning ranges (port of `prepareLearningResult`)

**Files:**
- Create: `go/internal/learning/{side.go,ranges.go,utf16.go}` + `*_test.go`, `e2e/fixtures/results/{learn-reading.json,learn-reading-ko.json,learn-overlap.json,learn-unicode.json,learn-repeat.json}`

Why custom: no library resolves model quotations into grapheme-safe, order-disambiguated ranges. This is a ~150-line port of TS logic, with `rivo/uniseg` for graphemes.

**Interfaces:**
- Produces:
  - `learning.Side(source, target, uiLang string) string`: `"source"` iff `target == uiLang && source != uiLang`.
  - `type Range struct{ Start, End int }` (UTF-16 units); `type SourceSpan struct{ Range; Text string }`.
  - `type Phrase` = the generated `learningPhrases` item: Text, Gloss, SourceTexts, BaseForm, LiteralMeaning, NaturalMeaning, Grammar, Omissions, GrammarHighlights, UsageNote, Characters.
  - `type Chunk struct{ Range; Text, Gloss, BaseForm, LiteralMeaning, NaturalMeaning, Grammar, Omissions, UsageNote string; Characters []CharNote; GrammarHighlights []Range; SourceSpans []SourceSpan }`.
  - `type Prepared struct{ Chunks []Chunk; Partial bool }`.
  - `learning.Prepare(counterpart, primary string, phrases []Phrase) (Prepared, bool)`. Same argument roles as TS `prepareLearningResult(source=counterpart, target=primary, …)`.
  - Algorithm note (the non-obvious part): encode both strings once as `[]uint16` (`utf16.Encode([]rune(s))`) and implement `indexOf(from)` / `lastIndexOf(from)` on code-unit slices with **exact JS semantics**: empty needle → `from` / clamped length, and a negative `from` in `lastIndexOf` is clamped to 0. Then every comparison is the TS one. The grapheme boundary set is built from `uniseg.NewGraphemes(s)`, accumulating `utf16.RuneLen` per rune, plus `len`. The steps, in TS order:
    - Phrase filter: `IsLearningText(text)` and contained in primary.
    - Ordered earliest/latest passes. If the order breaks, fall back to global first/last.
    - A phrase is kept only if earliest == latest and both ends are on grapheme boundaries.
    - Sort, then drop **both** members of any overlap.
    - Grammar highlights: only when `Grammar` is non-blank. A highlight resolves only as the unique occurrence inside its phrase, with both ends on boundaries. Sort by (start asc, end desc), then keep the non-overlapping prefix.
    - Characters: filter to `IsCharacterOrigin` notes whose word is inside the phrase text.
    - Source spans: unique occurrence in counterpart, on boundaries.
    - `Partial` = `IsLearningText(uncovered text)`.
    - Returns `false` when no phrases or no chunks survive.
- Not ported (dead code: only tests reference them): `resolveLearningResult`, `validateLearningResult`, `sentenceRanges`, `LegacyLearningPhrase(s)` and their page-memory fill-ins, `LearningInput.side`-omitted semantics, `wordOrder` (always `''`), and the learning `minimized` state (no rendering consumer).
- [ ] **Step 1: Failing tests.** Port these `src/lib/learningRanges.test.ts` cases (the ones that call `prepareLearningResult`) under the same names:
  - `retains complete phrase details and resolves only quoted grammar highlights`
  - `drops character notes that are not real hanja, kanji or hanzi for their word`, including the Japanese `懐かしい` case
  - `does not underline ambiguous quotes or split a combining-character grapheme`
  - `requires a grammar explanation before an annotation can be underlined`
  - `prepares exact phrase positions and meanings from the translation response without model-counted offsets`
  - `uses phrase order to resolve repeated quotes and leaves an ambiguous lone quote unmarked` (`oui oui`/`yes yes`)
  - `keeps independent Korean details when model quotations overlap`
  - `orders uniquely quoted details without inventing positions for ambiguous repeats`

  Dropped, because they test `validateLearningResult`/`sentenceRanges`, record this in the parity report: `validates Korean source chunks against the original…`, `keeps exact target text with reordered source correspondence`, `allows omitted source spans and labels incomplete target coverage`, `rejects overlapping target chunks`, `does not split emoji or combining-character graphemes` (validate variant), `distinguishes repeated source occurrences by exact offset`, `returns exact sentence slices…`. Their behaviours that apply to `Prepare` are covered by the new Go tests below.

  Port `src/lib/learningSide.test.ts` (all cases). New Go tests:
  - `TestPrepareOffsetsAreUTF16`: primary `"👍🏽 café 좋아요"` (`é` = `e`+U+0301), highlight `좋아요` → Range{8,11}. Assert it differs from the byte and rune offsets.
  - `TestPrepareSourceSide`: ko source / en target / ui en, spans in the Korean source.
  - `TestJSIndexSemantics`: empty needle, `lastIndexOf` clamp.
  - `FuzzPrepareMatchesTS`: optional, against a corpus generated by a tsx script into `testdata/`.
- [ ] **Step 2–4:** `go test ./internal/learning/` → FAIL, implement, PASS.
- [ ] **Step 5: Commit** (`feat(go): server-side learning ranges with UTF-16 offsets`).

### Task 19: Learning in the stream, Breakdown list, highlights and source mirror

**Files:**
- Create: `go/internal/web/learning.templ`, `e2e/tests/learning.spec.ts`
- Modify:
  - `go/internal/translate/{handler.go,events.go}`
  - `go/internal/web/{result.templ,composer.templ}`
  - `go/web/static/js/learning.js` (+ `learning.test.js`)
  - `e2e/visual/states.ts`

**Interfaces:**
- Consumes: Task 18, Task 17 shell.
- Produces:
  - Timing (deliberate deviation from the spec wording, stated in the code comment). Ranges are a whole-array computation: the ordered passes and overlap rejection need every phrase, so per-entry results are never final. The handler therefore starts `learning.Prepare` in a goroutine at the `learningPhrases` `ValueEnd`. In schema order that is before `rationale`, `alternatives` and `formalityNote`, so it still runs concurrently with streaming. Results are **sent just before `nt-done`**, because TS learning only opens once the result is done. Cache hits recompute (ranges depend on the raw, untrimmed `text`).
  - Partial `<hx-partial hx-target="#learning-inspector" hx-swap="outerHTML">` carrying `LearningInspector`: `section[aria-label=wholeSentence] > ul.learning-chunks > li`, where each `li` holds:
    - `button[data-testid=learning-chunk][aria-label="<text> <gloss||naturalMeaning>"][aria-expanded=false][aria-controls=lp-<run>-<i>]` with `span[lang]`, `span[aria-hidden]→`, `span`.
    - `div.phrase-detail#lp-<run>-<i>[role=region][aria-label][hidden]` with `dl.learning-facts`. Facts appear in order gloss (`inThisSentence`), baseForm (`lang`), literalMeaning, naturalMeaning, grammar, usageNote (`notes`), omissions, non-blank only, followed by CharacterNotes.

    Punctuation-only rows are omitted without renumbering. `p.learning-status` (`learningPartial`) appears when partial.
  - Named event `nt-learning` `{run, side, language, chunks:[{s,e,src:[[s,e]…],g:[[s,e]…]}], partial}`. It carries ranges only, no text.
  - `learning.js`:
    - `mainSegments(len, highlights, selected)` and `mirrorSegments(len, spans, grammar)`: pure functions returning `[{from,to,kind:'text'|'phrase'|'selected'|'grammar'|'mark'}]` with the TS skip rule (`start < cursor` → skip). Exported for node tests.
    - Apply main: `#main-translation` children become text, `span.inspectable-phrase[data-testid=inspectable-phrase][data-start]` and `mark.learning-highlight[data-testid=selected-phrase]`. The mirror is `div.source-highlight[data-testid=source-highlight][aria-hidden=true]` before the textarea in `.source-input-area`, with `span.source-grammar[data-testid=source-grammar][data-source-start]`, `mark.learning-highlight` and a trailing U+200B, rendered from `textarea.value`.
    - Rules (`LearningContext` / `OutputPanel` / `InputPanel`):
      - Target highlights only when side is `target`.
      - Source grammar underlines when side is `source`, before any selection.
      - The selected chunk is marked in main (side `target`) or via its `sourceSpans` in the mirror. With side `source`, the selected chunk itself is marked in the mirror.
      - Mirror styles synced from the textarea (`font`, `letter-spacing`, `line-height`, `padding`, `border-width`, `box-sizing`, `text-align`, `word-break`, `overflow-wrap`, `tab-size`) plus scroll offsets, on scroll and ResizeObserver.
    - One row expanded at a time. `selectChunk(i|null)` toggles `aria-expanded`/`hidden` and scrolls the row into view within `.reference-scroll, .learning-panel-body`.
    - Invalidation: input edit, settings/tone/language change, refine, Clear, `nt-error`, new run start, pagehide all clear the selection and mirror. Any `nt-learning` whose `run` ≠ the current run, or whose request key is stale, is ignored.
- [ ] **Step 1: Failing tests.**
  - Node `learning.test.js`: segment cases mirroring `InspectableTranslation.tsx` / `SourceHighlight.tsx` rendering (overlap skip, selected-within-highlight, empty).
  - Go `TestLearningEmittedBeforeDone`: `nt-learning` precedes `nt-done`; `Prepare` started before the first `rationale` delta (hook counter).
  - Go `TestCacheHitRecomputesWithRawText`: trailing-space text → shifted ranges.
  - e2e `learning.spec.ts` (`@learning`, both apps; ports of `tests/browser/learning.browser.tsx`):
    - `initial phrase details reveal locally and only grammar constructions are underlined`: default fixture → inspectable phrases exactly `["지내요"]`; expanding a row shows `Grammar` dt; `/_stats.requests` unchanged.
    - `English UI breaks down original Korean when translating into English` (`learn-reading.json`, source ko): `source-grammar` present, no `inspectable-phrase` on desktop.
    - `Korean UI breaks down original English when translating into Korean` (`learn-reading-ko.json`, UI ko).
    - `whole-message breakdown keeps every phrase visible with inline details and no sentence pagination`.
    - `Breakdown action never appears before phrase details arrive or after completion`: no button with text `breakdown`; rows absent until done.
    - `overlapping model quotes keep the remaining Korean source breakdown usable` (`learn-overlap.json`).
    - `initial phrase inspection clears on input edits, translation errors and Clear`.
    - `learning from a superseded run is ignored`: slow fixture, edit mid-stream → no rows from the old run.
    - `no-alternatives desktop example keeps all learning facts in phrase details`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. Same UI: markup per `LearningInspector.tsx`, `SourceHighlight.tsx`, `InspectableTranslation.tsx`. Visual states `learning-reference` (workspace, row expanded) and `learning-source-underlines` (reading fixture). `make size` passes.
- [ ] **Step 5: Commit** (`feat(go): streamed learning rows, highlights and source mirror`).

### Task 20: Inspection gestures (target tap and source underline tap)

**Files:**
- Create: `go/web/static/js/inspect.js` (+ `inspect.test.js`)
- Modify: `go/web/static/js/learning.js`, `e2e/tests/learning.spec.ts`

Why custom: no library implements the selection-safe tap rules or the mirror hit-testing. This is a port of `phrasePointer.ts`, `InspectableTranslation.tsx` and `SourceHighlight.tsx`.

**Interfaces:**
- Produces:
  - `isInspectTap(start, end, selection)` (`< 350 ms`, `< 8 px`, empty selection); `textOffsetAtPoint(root, x, y)` via `caretPositionFromPoint` / `caretRangeFromPoint`; `GRACE_MS = 400`.
  - Target gestures on `#main-translation`, only when interactive (not disabled, and whole-text or chunks or trigger):
    - Pointerdown capture records the start for button 0 with no selection.
    - Pointercancel and dblclick cancel.
    - Pointerup checks the tap and computes the offset (`< text.length`). Unless whole-text mode is on, the offset must be inside a chunk. It then sets a 400 ms timer that re-checks the selection and calls `onInspect(offset)`.
    - In mobile layouts (`!desktop`, sentence) the main `<p>` gets `role=button tabindex=0 aria-expanded`, and Enter/Space opens learning at 0.
    - Desktop with side `source` is plain and not tappable.
  - Source gestures on the textarea (no overlay, never `preventDefault`):
    - Pointerdown (primary, button 0, empty selection) hit-tests `.source-grammar` `getClientRects()` inside the textarea bounds.
    - Pointermove ≥ 8 px cancels. Pointerup only for the same `pointerId`.
    - The 400 ms timer requires the textarea to be connected and focused, its value unchanged and the selection empty.
    - Cancel events: `select`-with-selection, pointercancel, dblclick, keydown, input, compositionstart, scroll, blur, contextmenu, dragstart, pagehide.
  - `onInspect`:
    - Side `source` from a target tap: find the chunk whose `sourceSpans` contain the offset → `openAt(chunk.start)`, else the overview.
    - Otherwise `openAt(offset)`.
    - Mobile: blur the active element first.
    - Source-underline open: `openAt(offset, 'source')`, saving `{selectionStart, selectionEnd, selectionDirection, scrollTop, scrollLeft}`; blur only when `!desktop`.
- [ ] **Step 1: Failing tests.**
  - Node: `isInspectTap` boundary cases (349/350 ms, 7.9/8 px, selection).
  - e2e (`@learning`):
    - `a deliberate phrase tap selects its chunk without interfering with native selection`.
    - `deselecting native text and a long press do not inspect grammar`.
    - `tapping source grammar opens its phrase and preserves the editor caret`.
    - `scrolled source grammar stays accurate and scrolling cancels a pending tap` (two variants).
    - `source grammar tap survives the keyboard opening on focus` (visualViewport shim from `e2e/perf/page-scripts.ts`).
    - `dragging from a source grammar underline selects native editor text`.
    - `source grammar is visible before selecting a phrase and never changes editing`: typing after a tap cancels it, and the value and caret are unchanged.
    - `source grammar tap after emoji opens its phrase` (`learn-unicode.json`).
    - `double-click selects a word without opening learning`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. `make size` passes.
- [ ] **Step 5: Commit** (`feat(go): selection-safe phrase and source-underline inspection`).

### Task 21: Mobile full-size learning surface and focus restoration

**Files:**
- Modify: `go/web/static/js/learning.js`, `go/internal/web/learningpanel.templ`, `e2e/tests/learning.spec.ts`, `e2e/visual/states.ts`

**Interfaces:**
- Produces: the sentence path on the Task 17 shell.
  - Heading `learn · <selected text>`.
  - The inspector is moved into the panel while it is open; the reference stays hidden.
  - `inert` on the background header, source and result controls, while the Copy/Listen dock (`[data-testid=output-toolbar]`) stays mounted and usable beneath it.
  - Independent scroll in `.learning-panel-body`.
  - Close/Escape restores focus in this order: exact source caret, direction and scroll (when opened from an underline, and only if the learning identity is unchanged); else `word-details-trigger`; else `#main-translation`.
  - No Breakdown button, no minimize control, no automatic minimisation at short heights or with the keyboard.
- [ ] **Step 1: Failing e2e** (`@learning`, stack/split/laptop/book projects):
  - `mobile text opens a full learning view without a Breakdown button`.
  - `initial phrase details preserve Copy Paste Clear through overview and inspection`: Copy still copies main while open.
  - `closing learning opened from a source underline restores the exact caret`: selection 3–7, direction backward, scrollTop.
  - `learning can be deliberately restored at a short 440 / 320-pixel portrait height`.
  - `long results keep primary actions visible through incremental keyboard shrink and pan`.
  - `context and learner details remain usable without a popup`.
  - `keyboard Enter opens mobile learning from the main text`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. Same UI: `LearningPanel.tsx`. Visual state `learning-open` on mobile projects.
- [ ] **Step 5: Commit** (`feat(go): mobile learning surface with exact focus restoration`).

---

## Stage 5: pronunciation

### Task 22: Speech endpoint, WAV validation and fake upstream speech

**Files:**
- Create: `go/internal/speech/{config.go,wav.go,handler.go}` + `*_test.go`, `e2e/fixtures/results/{speech-slow.json,speech-error.json,speech-big.json,speech-long.json}`
- Modify:
  - `go/internal/fakeopenai/{fake.go,fake_test.go}`
  - `go/main.go` (route `POST /speech`)
  - `e2e/tests/helpers.ts` (`Stats` gains speech counters)

**Interfaces:**
- Produces:
  - Fake upstream `POST /v1/audio/speech` (honoured by `openai-go` and by TS `createOpenAI()`, which reads `OPENAI_BASE_URL`):
    - Records the JSON body.
    - Returns a deterministic WAV: RIFF size `0xFFFFFFFF`, `fmt ` (PCM 1, 1 ch, 24,000 Hz, byteRate 48,000, blockAlign 2, 16 bit), a `LIST` metadata chunk, data size `0xFFFFFFFF`, and 0.25 s of a 440 Hz tone (12,000 B).
    - Variants by substring of `input`: `[fx:speech-slow]` waits 3,000 ms before headers, `[fx:speech-error]` → 500, `[fx:speech-big]` → 2.5 MiB PCM, `[fx:speech-bad]` → 8-bit WAV.
    - `/_stats` gains `speechRequests`, `speechAborted`, `lastSpeechBodies` (last 5).

    These markers sit in the `main`/alternative text of the matching translation fixtures, because speech input is the translated text.
  - `speech.LoadConfig(getenv func(string) string) (speech.Config, error)`, `Config{Model, Voice string}`, `ErrConfiguration`.
  - `speech.Instructions(lang string) string`. Exactly `Read the text aloud in <Name> with natural native pronunciation, at a clear, relaxed pace.` with names English, Korean, Japanese, French, Spanish, Mandarin Chinese; for `auto`: `Read the text aloud with natural native pronunciation, at a clear, relaxed pace.`.
  - `speech.PCMFromWAV(wav []byte) (pcm []byte, sampleRate int, err error)`: line-by-line port of `pcmFromWav`.
  - `speech.NewHandler(c *llm.Client /* or *openai.Client */, getenv func(string) string, timeout time.Duration) http.Handler` for `POST /speech`, form fields `text`, `language`, `uiLang`.
    - Calls `client.Audio.Speech.New(ctx, openai.AudioSpeechNewParams{Model, Voice, Input, Instructions, ResponseFormat: wav}, option.WithMaxRetries(0))` with `ctx = context.WithTimeout(r.Context(), 90s)`. Verify the voice/format param types in context7 `/openai/openai-go`; arbitrary voice ids must be accepted.
    - Reads through `io.LimitReader(8 MiB + 65,536 + 1)` and validates the **whole** WAV.
    - Then writes `200`, `Content-Type: audio/L16;rate=<rate>;channels=1`, `Cache-Control: no-store`, PCM in 32,768 B writes with `Flush`.
    - Errors: JSON `{"error": <localized>}`. 400 for invalid input. 500 with `Pronunciation is not configured correctly.` / `발음 재생 설정이 올바르지 않아요.` for configuration. 502 for provider or invalid WAV and 504 for timeout, both with `Pronunciation failed. Please try again.` / `발음을 재생하지 못했어요. 다시 시도해 주세요.`.
    - No logging, no telemetry.
- [ ] **Step 1: Failing Go tests** (ports of `src/server/speech.test.ts`):
  - `TestInputValidation`: trims; rejects empty, 4,001 UTF-16 units, unknown language.
  - `TestConfigDefaultsAndOverrides`: `gpt-4o-mini-tts` and `marin`.
  - `TestInvalidVoice`: `" "`, 201×`x`, `"voice\x00id"`.
  - `TestLegacyPrefixRejected`: `openai/gpt-4o-mini-tts` → `ErrConfiguration`.
  - `TestInstructionsNameLanguage`.
  - `TestPCMFromWAV`: streaming sizes; exact RIFF size; LIST discarded; odd-chunk padding; rate 8,000/48,000 accepted; 7,999/48,001, stereo, 8-bit, bad blockAlign/byteRate, two fmt, two data, empty/odd data, data > 8 MiB, < 44 B and truncated all rejected.
  - `TestHandlerStreamsPCM`: fake body has model, voice, instructions naming Korean, `response_format:"wav"`; response content type and bytes equal the tone.
  - `TestNoRetry` (`speechRequests == 1` after a 500).
  - `TestClientAbortCancels` (`speechAborted == 1`).
  - `TestTimeout`: timeout 50 ms with the slow fixture → 504 in < 300 ms.
  - `TestLocalizedErrors` (en/ko exact strings).
  - `TestNoContentLogged`: captured `slog`/`log` output contains neither the input nor provider text.
  - Fake tests: `TestFakeSpeechWAV`, `TestFakeSpeechAbortCounted`.
- [ ] **Step 2–4:** `go test ./internal/speech/ ./internal/fakeopenai/` → FAIL, implement, PASS.
- [ ] **Step 5: Commit** (`feat(go): speech endpoint with WAV validation; fake speech upstream`).

### Task 23: PCM player, Listen controls, single playback owner, replay LRU

**Files:**
- Create:
  - `go/web/static/js/{pcm.js,speech.js}` (+ `pcm.test.js`, `speech.test.js`)
  - `go/internal/web/listen.templ`
  - `e2e/tests/speech.spec.ts`, `e2e/tests/syntheticAudio.ts` (init-script port of `tests/browser/syntheticAudio.ts`, exposing `window.__audio.finish()`, `.instances`, and an optional delayed `resume`)
- Modify: `go/internal/web/{result.templ,alternative.templ}`, `e2e/visual/states.ts`

**Interfaces:**
- Produces:
  - `pcm.js`: `class PcmPlayer { constructor(ctx); resume(); append(bytes: Uint8Array, rate): boolean; endInput(): Promise<void>; stop() }`. Port of `pcmPlayer.ts`: odd-byte carry, signed little-endian decode, schedule at `max(currentTime + 0.02, nextTime)`, 8,000–96,000 Hz rate, constant rate, ≤ 8 MiB, `endInput` throws on a dangling byte or zero samples.
  - `speech.js` (delegated on `[data-testid=listen-button]`):
    - Module-level `pagePlayback` (single owner) and replay LRU (Map; ≤ 3 entries, ≤ 4,194,304 B; entries over 4 MiB are not cached; refreshed on hit).
    - On tap: if text length > 4,000 → `speechTooLong`, return (no unlock, no request). Then `new (AudioContext || webkitAudioContext)()` and `resume()` **synchronously in the gesture** (failure → `speechUnavailable`, close the context). Stop the previous owner. Status `loading`.
    - After `await resume`, abort if no longer current (no request). Replay hit → append cached chunks. Otherwise `fetch('/speech', {method:'POST', body: FormData{text, language: known code || 'auto', uiLang}, signal})`, parse `rate` from `Content-Type`, read `body.getReader()`, append each chunk (status `playing` on the first successful append), reject over 8 MiB, cache on completion, `await endInput()` → idle.
    - Any failure → idle plus `speechFailed`, never the server message.
    - Stop: on second tap, on `nt-inputs-changed` (text, source, target, mode, context, refinements), uiLang change, new run, or pagehide. Owner cleanup is guarded by identity.
  - Markup (`ListenButton.tsx`):
    - Pill with tone `active` when not idle; `aria-label`/`title` = `speechLoading` | `stopListening` | `listen`; `aria-pressed`; `aria-busy` while loading.
    - Icon Loader2 14 (`animate-spin motion-reduce:animate-none`) / Square 14 / Volume2 14.
    - Main toolbar button labelled (`stopSpeech` when active, otherwise the label). Alternative rows use `size=sm` and `icon-action`.
    - Error `span[role=status][id]` with the `absolute right-0 top-full …` classes and `aria-describedby`.
    - Disabled unless the whole current non-error result is done. Language = reported `targetLang` ?? target.
- [ ] **Step 1: Failing tests.**
  - Node `pcm.test.js`, ports of `pcmPlayer.test.ts`:
    - `joins odd byte boundaries and decodes signed little-endian samples`
    - `finishes only after the final scheduled audio ends`
    - `stops queued sources, closes audio, and unblocks completion`
    - `rejects truncated frames, empty output, changed formats, and oversized audio`
  - Node `speech.test.js`: LRU entry and byte bounds; `[text, language]` keying.
  - e2e `speech.spec.ts` (`@speech`, both apps, synthetic audio):
    - `listen never autoplays and is disabled until the result completes`: `speechRequests == 0`.
    - `listen stops explicitly, completes after audio ends, and replays without a new request`.
    - `starting another voice stops the current one`.
    - `pronounces sentence alternatives without overlapping the main voice` and the word variant.
    - `another speaker aborts the connecting one` (`speech-slow`; `speechAborted == 1`).
    - `stop during slow unlock sends no request`.
    - `editing input cancels playback and switching sentence to word resets the result`.
    - `changing the target language aborts a connecting speech request`.
    - `pagehide cancels playback`.
    - `oversized text shows speechTooLong without unlocking or a request` (`speech-long.json`, main of 4,001 chars).
    - `speech failure shows a localized notice without provider text` (en `Couldn't play audio. Try again.`, ko from STRINGS).
    - `replay cache evicts beyond 3 entries and beyond 4 MiB` (`speech-big`).
    - `identical text in different languages is cached separately`.
    - `sends the selected language and falls back to auto`.
    - `labelled speech actions fit their box while loading and playing in en / ko`.
    - `dock speech failures stay visible inside the result pane`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. Same UI: `ListenButton.tsx`, `AlternativeItem.tsx`. Visual states `listen-loading`, `listen-playing` (synthetic audio, pulse masked). `make size` passes.
- [ ] **Step 5: Commit** (`feat(go): Listen with Web Audio PCM player, single owner and replay cache`).

---

## Stage 6: refine, context, settings and Adjust

### Task 24: Reply context, Settings popover and the shared positioner

**Files:**
- Create:
  - `go/internal/web/{context.templ,settings.templ}`
  - `go/web/static/js/{context.js,float.js,settings.js}` (+ `float.test.js`)
  - `e2e/tests/context.spec.ts`
- Modify: `go/internal/web/{composer.templ,header.templ}`, `go/web/static/js/composer.js`, `e2e/visual/states.ts`

Why `float.js` is hand-written: the spec forbids Floating UI (binding over "prefer libraries"), and the Adjust clearance rule plus pane-bounded shifting cannot be expressed in CSS anchor positioning alone. About 80 lines, budget 1.0 KB.

**Interfaces:**
- Produces:
  - `float.js`: `position(reference, floating, {placement: 'bottom-start'|'bottom-end', offset, padding, boundary?: Element, flip?: boolean, clearance?: Element}) => {x, y}` with fixed strategy. Shift keeps the panel within the boundary rect minus padding. Flip swaps to top when the bottom overflows. Clearance applies the Adjust rule. `autoUpdate(reference, floating, update)` uses ResizeObserver plus scroll/resize listeners and returns a cleanup.
  - `panelBoundary(reference)`: the port of `floatingPanelBoundary.ts`. Padding per side = `8 + --safe-area-<side>`. Boundary = closest `section` when `.translator-panels[data-layout]` ∈ `book|laptop|split|workspace`; otherwise the viewport.
  - Settings: Pill md `.settings-trigger[data-testid=settings-button][aria-label=settings]` with Settings 18. The popover `div.settings-popover[role=dialog][aria-label=settings]` is rendered at the end of `<body>` (FloatingPortal equivalent) with `popover="auto"`, positioned bottom-end, offset 8, flip + shift via `panelBoundary`. Non-modal: focus moves into the popover on open and returns on close; Escape and outside press close it. Content: `h2` `settings` and the UI-language toggle (`role=group aria-label="UI language"`, buttons `EN`/`한` with the `UiLangToggle.tsx` classes and `aria-pressed`), wired to the stage-2 `/prefs` flow.
  - Context:
    - `ContextToggle` Pill md `.context-toggle[data-testid=context-toggle][aria-expanded][aria-label=contextToggle]`, Reply 18, long and short labels, tone `active` when context is non-blank.
    - `div.composer-context > div.context-field > textarea[data-testid=context-textarea][maxlength=1000]` with the `ContextField.tsx` classes, plus `button[data-testid=context-clear]` (X 12) when non-empty.
    - `context.js`: restores `sessionStorage['nt.context']` (`JSON.parse`) on load and opens the field when non-blank; writes `JSON.stringify(value)` on input. Its value goes into the run form (`context`), and changes trigger the composer's debounced run (`debounceFor(text)`) when text is non-empty. Focusing the source while `data-keyboard` is set closes the field. Context survives Clear.
- [ ] **Step 1: Failing tests.**
  - Node `float.test.js`: shift and clearance arithmetic on fixed rects; flip.
  - e2e:
    - `toggle opens the context textarea and typing persists to sessionStorage`: value `"hi"` → `sessionStorage['nt.context'] === '"hi"'`.
    - `clear empties the context and keeps the field open`.
    - `context is sent with the run and edits re-run`: `lastBodies` contains `<context>`.
    - `context is restored after reload in the same tab`.
    - `Clear input preserves context and focuses source`.
    - `makes UI language available in settings and persists an explicit choice`: `<html lang="ko">`, cookie `uiLang` `ko` after reload.
    - `settings popover stays inside its pane in split and book layouts`.
    - `language menus stay within the viewport and support keyboard selection`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. Same UI: `ContextField.tsx`, `SettingsMenu.tsx`, `UiLangToggle.tsx`. Visual states `context-open`, `settings-open`. `make size` passes.
- [ ] **Step 5: Commit** (`feat(go): reply context, settings popover and pane-aware positioning`).

### Task 25: Refine chips, custom adjustment and rollback

**Files:**
- Create:
  - `go/internal/web/refine.templ`, `go/web/static/js/refine.js` (+ `refine.test.js`)
  - `e2e/tests/refine.spec.ts`
  - `e2e/fixtures/results/{refine-softer.json,refine-fail.json}`
- Modify:
  - `go/internal/fakeopenai/fake.go`: `match` may be a string or an array (all must occur); the most specific fixture wins (most entries, then filename).
  - `go/web/static/js/composer.js` (hidden `refinements`/`previousMain`, trigger `refinement`)

**Interfaces:**
- Produces:
  - Markup per `RefineRow.tsx`:
    - `div.refine-row > div.refine-controls` with `span.refine-label`.
    - Chip Pills `size=sm`, tone `active`/`accent`, `data-testid=refine-chip-<id>`, `aria-pressed`.
    - Either `refine-custom` (active Pill: `aria-pressed`, `aria-label="<refineRemove>: <full>"`, `title=<full>`, text = first 20 chars + `…`) or `refine-custom-trigger` (Plus 16, `aria-expanded`) plus `div.refine-custom-editor[hidden]` holding the `refine-freeform` input (`maxlength=200`, placeholder/aria-label `refinePlaceholder`), `refine-apply` (accent) and `refine-close` (X 18, `aria-label=refineClose`).
    - `p[data-testid=refine-error]` = `<refineFailed>: <message>`.
    - Server-rendered once in the header (Task 26 places it) and never re-created (draft and focus survive).
  - `refine.js`, state `{refinements, previousMain, stack: Snapshot[] (≤ 10)}`.
    - Ready = done ∧ ¬streaming ∧ ¬pending ∧ current.
    - Toggle add: dedupe, cap 3. Push a snapshot `{resultDOM: clone of #result-content and #learning-inspector, live state, refinements, previousMain}`, set `previousMain := current main`, request with trigger `refinement` (immediate).
    - Toggle remove: push a snapshot, then `previousMain := next.length ? main : ''`.
    - Free text: trim, slice to 200; Enter submits unless `isComposing`. At most one custom entry; clicking the custom button removes it and reopens the editor.
    - On `nt-error` while the refine is in flight: pop the snapshot, restore the DOM and state, show `refine-error` (or `.adjust-error[role=alert]` when Adjust is collapsed), mark Copy current again.
    - `refineError` clears on any refine action, input edit or new completed result, but not on the rollback itself.
    - Input edit clears everything. Context, tone and target changes make chips stale (disabled) until the new result.
    - Close preserves the draft and returns focus (Task 26 decides the target).
- [ ] **Step 1: Failing tests.**
  - Node `refine.test.js`: cap, dedupe, custom uniqueness, `previousMain` reset to `''`, stack depth 10.
  - e2e `refine.spec.ts` (`@refine`, both apps; ports of `RefineRow.test.tsx` and `TranslatorContext.test.tsx`):
    - `chips toggle and re-run immediately`: request within 300 ms; body contains `<adjustments>` + `make it softer` + previous main; toggling off → served from cache, `requests` unchanged, main restored.
    - `free-text Enter replaces the input with a truncated custom button and clicking it restores the input`: 25-char input.
    - `caps at 3 adjustments`: remaining chips and free text disabled.
    - `offers Apply and Close, preserving an unapplied draft`.
    - `keeps static refinement controls disabled while a sentence is incomplete`.
    - `tone / target / context change disables chips until the new result` (3 cases).
    - `renders nothing without a completed sentence result`: word result → no `adjust-button`.
    - `failed refine rolls back to the previous result with a compact notice`: custom `[fx:refine-fail]` → main equals the previous main; no custom button; `refine-error` = `Adjustment failed: <STRINGS.en.translationFailed>`; the clipboard after Copy equals the previous main.
    - `a non-refine error does not roll back`.
    - `editing the input clears refinements`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. `make size` passes.
- [ ] **Step 5: Commit** (`feat(go): refine chips, custom adjustment and rollback`).

### Task 26: Adjust layout rules (inline chips vs disclosure, floating panel, tight-keyboard editor)

**Files:**
- Create: `go/internal/web/adjust.templ`, `go/web/static/js/adjust.js` (+ `adjust.test.js`)
- Modify: `go/internal/web/header.templ`, `e2e/tests/refine.spec.ts`, `e2e/visual/states.ts`

**Interfaces:**
- Produces:
  - Markup per `AdjustMenu.tsx`:
    - `div.adjust-menu[data-inline]` containing the trigger Pill md: tone `active` when there is a summary or it is open, `data-active` when there is a summary, `data-testid=adjust-button`, `aria-expanded`, `aria-controls`, class `adjust-trigger` (+`adjust-trigger-compact`), `aria-label="Adjust · <summary>"`, title only when icon-only, SlidersHorizontal 18 when icon-only, otherwise the text and ChevronDown 14 (`rotate-180` when open). Hidden by inline `display:none` when inline.
    - `div.adjust-content[role=group][aria-label=adjust][data-open][aria-hidden][inert][data-overlay]` holding `span.adjust-inline-label` and the single RefineRow (Task 25).
    - `p.adjust-error[role=alert]` when collapsed with a refine error.
    - Summary: chip labels or custom (20 + `…`) joined with ` · `.
    - The header reserves the adjustment slot even before a sentence exists (base.css), and the menu shows only for a live sentence result.
  - `adjust.js` (port; ResizeObserver on root and controls):
    - Measure skips when `.app-shell[data-short]` and the custom editor is visible. Icon-only and inline thresholds as in Global Constraints. If not fitting while focus is inside the controls → open. If fitting while focus is on the trigger → after inline, focus the first chip.
    - Overlay positioning via `float.js` (bottom-start, offset 12, shift padding 16, clearance `.primary-result-actions`).
    - `--adjust-panel-height` on `.app-header`.
    - Close when the input becomes empty.
    - Outside dismiss via a document `click` listener in the bubble phase (after the click's own action). Escape on document closes and focuses the trigger (`preventScroll`); Escape inside stops propagation.
    - Custom close → if not inline, close the menu; focus the textarea (`preventScroll`).
    - Tight keyboard (`data-keyboard` + `data-tight`) shows only the Custom input with 44 px Apply/Close.
- [ ] **Step 1: Failing tests.**
  - Node `adjust.test.js`: the fits/iconOnly arithmetic at 111/112 px and `needed + 2` edges.
  - e2e (`@refine`; ports of `AdjustMenu.test.tsx`, `learning.browser.tsx`, `mobile.browser.tsx`):
    - `shows active adjustments while collapsed and retains a custom draft through collapse`.
    - `closes with Escape even when a touch activation leaves focus outside the menu`.
    - `adjustments stay with tone in the header and expose chips when there is room`: macbook `data-inline`, phone trigger visible.
    - `desktop Adjust overlays without growing the header or covering primary actions`: header height unchanged ±0.5 px; panel rect ∩ `.primary-result-actions` = ∅.
    - `mobile Adjust floats without resizing the header or moving Copy in portrait and split views`.
    - `opening Custom with phrase details already open keeps Copy clickable`.
    - `header custom adjustments keep keyboard focus and restore the source keyboard layout`: visualViewport shim, tight; `--adjust-panel-height` > 0; Apply/Close ≥ 44 px; Close → textarea focused.
    - `adjustment width measurement reconnects after an error and same-sentence retry`.
    - `header settings keep their position when sentence adjustments first appear`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. Visual states `adjust-inline` (macbook), `adjust-open` (phone/split), `adjust-custom-tight` (keyboard shim). `make size` passes.
- [ ] **Step 5: Commit** (`feat(go): Adjust measured-width chips, floating panel and tight-keyboard editor`).

---

## Stage 7: layouts, telemetry, deployment, report and sign-off

### Task 27: Workspace layout engine (modes, panel order, keyboard, fold, safe areas)

**Files:**
- Create: `go/web/static/js/layout.js` (+ `layout.test.js`), `e2e/tests/layout.spec.ts`
- Modify: `go/internal/web/workspace.templ`, `go/web/static/js/{app.js,composer.js}`, `e2e/visual/states.ts`

**Interfaces:**
- Produces:
  - Server first paint identical to TS SSR (`COMPACT_LAYOUT`):
    - `main.app-shell[data-layout=stack]` holding the header and `div.workspace-viewport > div.translator-panels[data-layout-pending][data-layout=stack][data-result-first]`.
    - Panels in the order **output, input**, with no viewport reads during render; CSS container queries choose the startup arrangement, exactly as `TranslatorWorkspace.tsx` + base.css.
  - `layout.js`, a port of `useWorkspaceLayout` + `useFoldLayout`:
    - `measure()` follows Global Constraints.
    - Writes `--app-height`/`--app-top` on the shell and `--workspace-height` on the panels, `--panels-top` in laptop posture (ResizeObserver on panels and header).
    - Sets `data-layout`/`data-desktop`/`data-short`/`data-tight`/`data-keyboard` on both elements and `data-result-first` on the panels; removes `data-layout-pending` after the first measure.
    - Listeners: ResizeObserver(panels) via rAF, window resize, visualViewport resize **and** scroll, panels focusin/focusout, both posture media queries.
    - Panel order: when `resultFirst` changes, **move only `.output-panel`** (`append` / `prepend`), so the input panel and textarea are never moved.
    - Focus restore after a change when `document.activeElement === body`.
    - Keyboard entry sets `.result-scroll.scrollTop = 0`.
    - Reference visibility per Task 17.
    - Composer auto-grow: clamped to computed min/max-height (52/180 px fallbacks), re-measured on width change.
    - Dispatches `nt-layout` `{mode, desktop, short, tight, keyboard, resultFirst}` for `adjust.js`/`learning.js`.
- [ ] **Step 1: Failing tests.**
  - Node `layout.test.js` (pure `decideLayout({width, sideInsets, natural, visible, editing, touch, zoom, posture})` from `useWorkspaceLayout.test.tsx` cases): `tracks the visible keyboard height`, `chooses the compact layout from usable width when the background extends into side insets`, `keeps landscape split before and during a panned Safari keyboard viewport`, `keeps a portrait workspace stacked when its focused keyboard reduces visible height`, `useFoldLayout` header offset cases.
  - e2e `layout.spec.ts` (`@layout`, both apps):
    - `layout changes keep the textarea node, caret and focus`: `window.__ta` identity across a 1512 → 700 → 1512 resize while focused, with caret at 5.
    - `workspace to Duo resizing preserves the source node cursor and applied context`.
    - `server-rendered first paint matches the measured layout with 0 / 12 / 64 px side insets`: block same-origin external JS, record boxes of `.app-header`, textarea, `[data-testid=output-toolbar]`, chips; reload normally; compare ±1 px; inject insets via `page.route` HTML rewrite setting `--safe-area-left/right`.
    - `wide workspaces put excess space outside and align tone and mirrored actions`.
    - `desktop source and reference share the left pane while alternatives stay right`.
    - `Duo landscape uses source-side notes without changing pane order`.
    - `split source and result actions share a bottom dock for empty / translated / long turns`.
    - `Paste Clear and the main result actions remain visible and touch sized` (≥ 44 px).
    - `A workspace keeps long source and result controls above the safe bottom edge` (`--safe-area-bottom: 34px`).
    - `mobile multiline source stays expanded while typing and after the result arrives`.
    - `Return adds a line even with a pending translation`.
    - Fold, Chromium only: posture via CDP `Emulation.setDevicePostureOverride` / `setDisplayFeaturesOverride` (verify availability in Playwright's Chromium; fall back to an init-script `matchMedia` stub, which drives `data-layout` just as TS does). Tests: `folded translation keeps the editor expanded without a collapse control (keyboard false/true)`, `folding and unfolding preserve multiline editing and reachable actions (keyboard false/true)`, `folded keyboard editor has a continuous surface and named actions`. WebKit fold is marked manual.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS. Same UI: `TranslatorWorkspace.tsx`, `InputPanel.tsx` auto-grow. `make size` passes.
- [ ] **Step 5: Commit** (`feat(go): workspace/split/stack/fold layouts with SSR-identical first paint`).

### Task 28: Keyboard and safe-area parity suite, and the user check-in on keyboard behaviours

**Files:**
- Modify: `e2e/tests/layout.spec.ts`, `e2e/tests/helpers.ts` (`installVisualViewport(page)` and `keyboard(page, {steps, finalHeight, offsetTop})` reused from `e2e/perf/page-scripts.ts`), `e2e/visual/states.ts`

- [ ] **Step 1: Failing e2e** (`@layout`, phone projects, both apps). Ports of `tests/browser/mobile.browser.tsx`:
  - `long results keep primary actions visible through incremental keyboard shrink and pan` (50 px steps to 50 %, then pan `offsetTop` to 12.5 %): main first line, textarea and caret inside `[offsetTop, offsetTop + height]`; textarea focused.
  - `a tight keyboard hides the header and transfers the top inset to the shell`.
  - `keyboard entry resets the result scroll to the main translation`.
  - `keyboard layouts keep at least two editable source lines and sticky actions`.
  - `short stacked windows hide the target-language row to keep main text tappable`.
  - `main actions keep one stable slot while translation and explanation grow`.
  - `stream completion keeps Copy, language controls and existing alternatives anchored`.
  - `wording placeholder uses its real text line height while main Copy stays available`.
  - `Korean controls and a full input keep the conversation actions reachable`.
  - `source sizing keeps Clear reachable for long and short turns`.
  - `portrait keeps alternatives readable with an expanded multiline source`.
  - `landscape sentence notes use the card width without reserving bottom insets above the result`.
  - `wide result languages cannot overlap the reserved main actions near the breakpoint`.
  - `technical translation description has a quieter measure and clear spacing`.
  - `long text keeps source learning separate from output wording without a result focus ring`.
  - `aligned workspace keeps matching action boxes and usage with its translation`.
  - `source surface stays stable while typing and controls keep keyboard focus`.
- [ ] **Step 2–4:** run → FAIL, fix in `layout.js`/CSS (`go.css` only with a justification), run → PASS. Visual states `keyboard-open` and `keyboard-tight` on phone projects.
- [ ] **Step 5: Keyboard review evidence (user is away — Ruling: no blocking check-in).** Capture each documented keyboard behaviour in the Go app (iPhone WebKit and Pixel Chromium profiles; screenshots and a short Playwright video) into `test-results/keyboard-review/` and list them, one line each, in the parity sign-off so the user can reject any later. Port all behaviours for parity.
- [ ] **Step 6: Commit** (`test: keyboard and safe-area parity suite`).

### Task 29: Langfuse telemetry over OTLP (content-free)

**Files:**
- Create: `go/internal/telemetry/{telemetry.go,telemetry_test.go}`
- Modify: `go/internal/translate/handler.go`, `go/main.go`, `go/web/static/js/composer.js` (analytics form fields), `go/go.mod`

**Interfaces:**
- Produces:
  - `telemetry.Setup(getenv func(string) string) *telemetry.Tracer`. Disabled (no-op, zero cost) unless `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are both non-blank. Otherwise it builds an `sdktrace.TracerProvider` with `sdktrace.WithSyncer(otlptracehttp.New(...))`, which exports on span end, equivalent to TS `exportMode:'immediate'`:
    - Endpoint `${LANGFUSE_BASE_URL or https://cloud.langfuse.com}/api/public/otel/v1/traces`.
    - Headers `Authorization: Basic base64(pk:sk)` and `x-langfuse-ingestion-version: 4`, per Langfuse's OTel docs as of 2026-11-02. Re-verify with context7 `/langfuse/langfuse-docs` at implementation time.
    - Exporter timeout 2 s.
    - Resource attributes `langfuse.environment` = `LANGFUSE_TRACING_ENVIRONMENT` and `langfuse.release` = `LANGFUSE_RELEASE` when set.
    - Initialisation or export failure → `warnOnce("[langfuse] …")`; never fatal.
  - `(*Tracer) StartGeneration(ctx context.Context, rc telemetry.RuntimeContext) (context.Context, *telemetry.Generation)` and `(*Generation) End(usage llm.Usage, err error)`. Span name `translation`, with exactly these attributes:
    - `langfuse.observation.type=generation`, `langfuse.trace.name=translation`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`.
    - `langfuse.observation.metadata.<k>` for each key of `SAFE_TRANSLATION_CONTEXT_KEYS`: intent, mode, sourceLanguage, targetLanguage, uiLanguage, hasContext, refinementCount, requestKind, inputLengthBucket, isPolish, promptVersion, requestedModel, reasoningEffort, serviceTier, trigger, analyticsSessionId, clientRunId, supersedesRunId, inputRevision.
    - An error kind (classified `llm.Kind` only) on failure.
  - No input/output attributes, no provider metadata, no served tier.
  - `telemetry.RuntimeContext` mirrors `translationRuntimeContext`:
    - `requestKind`: `refinement` if refinements are present, `context` if context is present, else `initial`.
    - `inputLengthBucket`: `0`, `1-24`, `25-100`, `101-500`, `501-2000`, `2001+`.
    - `isPolish` = source == target. `promptVersion` = `CacheVersion`.
  - All allowlist fields are populated by the TS client (`useTranslate.ts:261-265`), so none are "unused" and the full allowlist is ported. The Go client sends these form fields, all excluded from the cache key and validated: `analyticsSessionId` (per-page UUID), `supersedesRunId`, `inputRevision` (int), `trigger` (`debounce|paste|enter|blur|force|refinement`).
  - Span `End` runs after `nt-done` has been written and flushed, so export latency never delays visible output (Go on Vercel has no `waitUntil`). Cache hits and speech create no span.
- [ ] **Step 1: Failing Go tests** using `sdktrace/tracetest.NewInMemoryExporter`:
  - `TestDisabledWithoutBothKeys`.
  - `TestAttributeKeysExactlyAllowlist`: set equality.
  - `TestNoContentInSpans`: no attribute value contains the fixture source nonce, context, refinement, main or rationale.
  - `TestCacheHitCreatesNoSpan`.
  - `TestSpanEndsAfterDoneFlushed`: event order hook.
  - `TestExporterFailureIsNonFatal`: OTLP receiver returns 500 → translation still completes; warning logged once.
  - `TestOTLPHeaders`: an `httptest` receiver sees the Basic auth and ingestion-version headers and an `application/x-protobuf` body.
- [ ] **Step 2–4:** `go test ./internal/telemetry/ ./internal/translate/` → FAIL, implement, PASS. Also verify the Vercel Analytics script tag (`/_vercel/insights/script.js`, deferred) is present as in the TS root; add it if missing.
- [ ] **Step 5: Commit** (`feat(go): content-free Langfuse generation traces over OTLP`).

### Task 30: Production deployment on Vercel and billed smoke

**Files:**
- Create: `go/cmd/smoke/main.go` (+ `smoke_test.go` against the fake), `e2e/tests/prod-smoke.spec.ts` (tag `@prod`, excluded from CI and default runs)
- Modify: `go/vercel.json` (only if bundling or headers require it), `go/README.md` (deploy and env notes)

**Interfaces:**
- Produces:
  - `go run ./cmd/smoke -url <base> -translate|-speech [-bypass $VERCEL_AUTOMATION_BYPASS_SECRET]`. Go equivalents of `scripts/smoke-translate.mjs` / `smoke-speech.mjs`: one request each. They print timings (first delta, main-ready, done, delta spacing), never content. Tested against the fake.
  - Production: Vercel project `translater-go` (`prj_3IE6TKizvmwJgFxixcTJuWiMi4C6`, team `team_i7CNkt1Y5v3ESWvNols5IEhP`), Go framework preset, root directory `go/`.
- [ ] **Step 1: Pre-deploy gate.** `go test ./...`, the full `APP=go` e2e suite, `make size`, and generated files fresh (`go generate`, `templ generate`, `make css`, `git diff --exit-code`).
- [ ] **Step 2: Copy env vars** from the existing `translater` project, writing them only to the scratchpad and never to the repo:
  - `vercel env pull --environment=production --cwd <scratch link of translater> <scratchpad>/translater.env`.
  - For each of `OPENAI_API_KEY TRANSLATE_MODEL TRANSLATE_REASONING TRANSLATE_SERVICE_TIER SPEECH_MODEL SPEECH_VOICE LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY LANGFUSE_BASE_URL LANGFUSE_TRACING_ENVIRONMENT LANGFUSE_RELEASE` that is present: `printf %s "$VALUE" | vercel env add <NAME> production --cwd go`.
  - Strip any legacy `openai/` prefix from `*_MODEL` values (the Go app rejects it by design), and record that this was done.
  - Delete the scratch env file.
  - `vercel env ls production --cwd go` lists the same names.
- [ ] **Step 3: Deploy.** `cd go && vercel deploy --prod`. Record the deployment URL and production domain. Confirm the following:
  - `GET /` returns `Cache-Control: private, no-store` and `Vary: Cookie, Accept-Language`.
  - Hashed assets are `immutable` and embedded (no 404s).
  - `/translate` responds with `text/event-stream` and no `Content-Encoding` buffering.
  - Use the protection-bypass header if Deployment Protection applies.
- [ ] **Step 4: Billed smoke (standing go-ahead): exactly one translation and one speech.** Run `PROD_URL=<domain> npx playwright test -c e2e --grep @prod --project chromium-macbook-14`. It types one synthetic sentence and then asserts:
  - Main text grows over ≥ 3 DOM observations more than 50 ms apart (Review Focus 5 of stage 2 on the real endpoint).
  - Copy is enabled before done.
  - Listen goes loading → playing → idle (real audio).
  - No console errors.

  Then check Langfuse: `GET $LANGFUSE_BASE_URL/api/public/traces?limit=1` (Basic auth) shows a `translation` trace whose observations carry no input/output. Record the numbers in the report.
- [ ] **Step 5: Commit** (`chore(go): production deployment, smoke tooling`) with the README env table.

### Task 31: Final performance comparison report (TS vs Go)

**Files:**
- Create:
  - `docs/superpowers/reports/<date>-go-vs-ts-performance.md`
  - `docs/superpowers/reports/data/<date>-final-{ts,go}-{fake,live}.json`
  - `docs/superpowers/reports/data/<date>-devtools-{ts,go}.json` (trace summaries)

- [ ] **Step 1: Fake runs** (same machine, browsers and profiles as the baseline; the table writer refuses mismatches):
  - `npx tsx e2e/perf/measure.ts --app ts --fake --runs 10 --out …final-ts-fake.json`
  - the same with `--app go`
- [ ] **Step 2: Live runs (billed, standing go-ahead).** Print the plan's billed count first (90–210 per app). Then `--live --i-understand-this-is-billed --runs 10` against the TS production URL (`https://www.neofox.dev`) and the Go production domain, with the throttle proxy as CONNECT proxy for both.
- [ ] **Step 3: Chrome DevTools MCP traces** on both production URLs with identical settings: emulate 412×915 @2.625, Slow 4G, 4× CPU, cold-cache reload, page load only. Record TTFB, FCP, LCP with breakdown (TTFB/load delay/load time/render delay), CLS, critical-path latency, scripts, and DevTools insights. Run one additional trace per app of the interaction "type one sentence → main visible" (1 billed translation each).
- [ ] **Step 4: Write the report** with `npx tsx e2e/perf/table.ts ts.json go.json` tables and these presentation rules:
  - **First typeable is presented as "kept and acted on":** `max(FCP, earliest kept keystroke, earliest acted-on keystroke)`, i.e. the burst typed at first focus counts only if it is still in the field and translated. Directly beside it go the **wipe/ignore gate** rows: wiped n/10, ignored n/10, and "wiped and the remainder translated (extra billed request)" n/10.
  - The **retype model** (settle point + Clear + retype) is secondary: shown only in a "dropped-run penalty" subsection, never as the headline.
  - Deciding metrics: page load (TTFB, FCP, LCP, first typeable), client JS gzip (Go budget 40 KB vs TS 285.3 KiB), CSS gzip.
  - Secondary: last key → first main char / Copy enabled / done (fake-paced; live dominated by OpenAI, stated plainly), keyboard movement and visibility rows (dy is not "lower is better"), cold vs warm TTFB (live cold is first-request-of-session only), repeat visits, DevTools traces side by side.
  - Cost and behaviour: superseded runs on Vercel are not cancelled for Go (stage 0 decision). Report the count of superseded upstream requests per settled-page and typing scenario from the fake runs (`/_stats.requests` vs counted translations) for both apps.
  - Code size: lines of Go + templ + JS + Go-only CSS vs TS/TSX + CSS (excluding generated and tests), and a per-module JS byte table vs budget.
  - Closing recommendation: replace or keep, with caveats (Go runtime Beta on Vercel, no request cancellation, any parity exceptions from Task 32).
- [ ] **Step 5: Commit** (`docs: final Go vs TS performance report`).

### Task 32: Parity sign-off

**Files:**
- Create: `docs/superpowers/reports/<date>-parity-signoff.md`
- Modify: `.github/workflows/go.yml` (run every e2e tag on both apps; visual job on demand)

- [ ] **Step 1: Full suite on both apps, all 18 projects.** `E2E_TS_BUILD=prod APP=ts npx playwright test -c e2e --grep-invert @prod` and `APP=go …` both pass with 0 failures and 0 unexplained skips (WebKit fold tests are the only declared skips). Also `go test ./...`, `node --test go/web/static/js/`, `npm test`, and `npx vitest run src/server/sharedPrompts.test.ts` pass.
- [ ] **Step 2: Visual comparison.** `npm run e2e:visual` covers every state in `e2e/visual/states.ts` (empty, sentence-done, streaming-skeleton, error-provider, error-input, word-done, reference-word, learning-word-open, learning-reference, learning-source-underlines, learning-open, listen-loading, listen-playing, context-open, settings-open, adjust-inline, adjust-open, adjust-custom-tight, keyboard-open, keyboard-tight) at the nine viewports × Chromium/WebKit. All screenshots must be within `maxDiffPixelRatio 0.001` and all ARIA snapshots equal. Any accepted exception is listed with its diff image and reason.
- [ ] **Step 3: Parity matrix in the sign-off report.**
  - (a) Every test in `tests/browser/*.browser.tsx` and every behaviour-level component test (`RefineRow`, `AdjustMenu`, `SettingsMenu`, `ContextField`, `WordSourceMeta`, `LearningInspector`, `LearningPanel`, `InspectableTranslation`, `OutputPanel`, `ListenButton`, `useSpeech`, `useWorkspaceLayout`, `useFoldLayout`) mapped to its e2e test name with TS/Go results.
  - (b) Every `AGENTS.md` bullet mapped to a test or a manual check.
  - (c) The not-ported list with reasons: legacy localStorage migration and head bootstrap, `openai/` prefix stripping, page-memory gloss-only compatibility, `resolveLearningResult`/`validateLearningResult`/`sentenceRanges`, the learning `minimized` state, `aiSdkWarnings` (no Go equivalent needed), and any keyboard behaviours the user dropped in Task 28.
  - (d) The Go-only CSS rules in `go.css`.
  - (e) The JS budget from `make size`.
- [ ] **Step 4:** Push the branch and confirm CI passes. **Commit** (`docs: parity sign-off for the Go app`).
