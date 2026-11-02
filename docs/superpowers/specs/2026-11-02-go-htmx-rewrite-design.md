# Go + htmx rewrite of the translator

Date: 2026-11-02. Status: approved by the user 2026-11-02.

## Intent

Build a second implementation of the translator with a Go server and htmx in the
browser, run it beside the current TanStack Start app, and compare the two with
measured numbers. If the Go version is clearly better it replaces the current
app, so it is built to production standard, not as a throwaway.

What motivated it (user's words, paraphrased): slow page load and odd JavaScript
behaviour on mobile (opening the keyboard moves the layout). The comparison is
about:

1. page load speed,
2. speed of interaction (typing, tapping, copying),
3. how soon the translation is available,
4. a much smaller JavaScript bundle,
5. doing more async work — running work earlier and in parallel so the browser
   waits less, without paying OpenAI for work nobody asked for.

## Goals

- **Full feature parity** with the current app (everything in `AGENTS.md`):
  sentence/word modes, tones, streaming main + details, main Copy as soon as
  the main string closes, alternatives with their own Copy/Listen, refine
  chips + custom adjustment, reply context, contextual learning (phrase rows,
  grammar underlines, source highlight, mobile learning surface, desktop
  reference pane), word dictionary, pronunciation, UI language, settings,
  preference cookie, language chip bars, workspace/split/stack/fold layouts,
  keyboard/visualViewport handling, safe areas, shortcuts, error
  classification, LRU cache, warm-up, cancellation.
- **Measured improvement** on the metrics below, measured identically on both apps.
- **Server-side async where it is free**: anything that costs no OpenAI money
  moves earlier or runs concurrently (see "Async model").
- **Maintainability**: a smaller, more legible codebase than the current
  ~12.5k lines TS + 3.4k lines CSS, with most UI state living on the server.

## Non-goals

- **No legacy or dead code paths** (user decision 2026-11-02): this is a new app.
  Port only live behaviour. Not ported: the legacy-localStorage preference
  migration, `openai/` model-prefix stripping, compatibility with older
  page-memory/gloss-only result shapes, legacy defaults kept only for old
  callers (e.g. learning `side` omitted ⇒ target), unused analytics fields.
  Schema/prompt field names stay as they are (they are prompt content, and
  the golden requests must match).

- No change to model, reasoning effort, service tier, prompt content, schema
  or few-shot examples. Otherwise the comparison measures the prompt, not the
  stack.
- No new paid behaviour: no speculative audio generation (the user confirmed
  ~99% of translations are never listened to), no automatic retries, no
  fallback model.
- No more aggressive speculative translation than today in the parity version
  (keep the 800ms / 400ms debounce rules) so time-to-result is comparable.
  Earlier firing is a later, separate experiment.
- Not a redesign: same visual design, tokens, type scale and layouts.

## Anti-goals (would make this a failure even if it "works")

- Swapping the source textarea node (losing cursor, focus, IME composition,
  scroll) because of an htmx swap. The textarea is never inside a swap target.
- "htmx" that is really a hand-rolled SPA in vanilla JS of similar size.
- Paid OpenAI work continuing after the user changed the input (billing for
  superseded requests).
- Two copies of the prompt that silently drift apart.
- Source text, context, output or prompts leaking into logs, telemetry or
  storage (same privacy rules as today).

## Baseline (current app, measured 2026-11-02 from `npm run build`)

| Metric | Current |
| --- | --- |
| Client JS | 945 KB raw / **297 KB gzip** (2 chunks: `routes` 584 KB, `index` 361 KB) |
| CSS | 146 KB raw |
| Source | ~12.5k lines TS/TSX (excluding tests), 3.4k lines CSS |
| Runtime deps | React 19, TanStack Start/Router, AI SDK 7, Floating UI, tinyld, zod, partial-json, OpenTelemetry/Langfuse |

**Targets for the Go version:** client JS ≤ 40 KB gzip including htmx 4
(measured) and all hand-written code; CSS no larger than today.

### Measurement protocol

Measured on the production deployment of each app, same region, same device
profiles (a real phone where possible, plus Lighthouse mobile throttling and a
MacBook profile), 10 runs each, median reported:

- TTFB, FCP, LCP, TBT/INP, total transferred JS/CSS bytes,
- time until the textarea accepts input (first typeable),
- time from last keystroke → first translated character visible,
- time from last keystroke → main ready (Copy enabled),
- time from last keystroke → full result complete,
- cold-start vs warm instance TTFB for the server.

The current app's production numbers are recorded **before** Go work starts
(stage 1). A script in the repo reproduces the measurement (Playwright +
`PerformanceObserver` / CDP tracing). Time-to-translation is dominated by
OpenAI latency; expect small gains there and say so in the report.

## Architecture

### Layout in the repo

A new top-level `go/` directory with its own `go.mod`, deployed as a separate
Vercel project (root directory `go/`). The current app is untouched until a
replacement decision. Go toolchain is managed by mise (user's global setup).

### Toolchain versions (user decision)

Use the newest features of **Go 1.27** and **htmx 4.0**; check details with
context7 (`/golang/go/go1.27.3`, `/golang/website`, `/bigskysoftware/htmx/v4.0.0`)
rather than memory. Relevant to this design:

- **Go 1.27:** `go 1.27` in `go.mod`. `encoding/json/v2` + `encoding/json/jsontext`
  (token-level streaming decoder; use for final strict decoding and, where it
  fits, the incremental parser — note a string token is only delivered once it
  closes, so per-character `main-delta` still needs a small hand-written
  string scanner on top). Generic methods and nested-field struct literal keys
  are available; use them where they make code clearer, not for their own sake.
- **htmx 4.0:** built on `fetch`, with readable-stream responses and SSE in
  core. An SSE response can come from **any method, including POST**, so the
  single streaming POST below is plain htmx, not a hand-written `fetch`
  reader. Unnamed SSE messages carrying `<hx-partial hx-target=… hx-swap=…>`
  swap server-rendered HTML into several targets; **named** SSE events
  dispatch DOM events instead of swapping (use them for `main-delta`,
  `main-ready`, `source-lang`, so small JS modules handle text append and
  Copy readiness). `htmx.trigger(el, "htmx:abort")` cancels a run. Event
  names and `event.detail.ctx` changed from htmx 2 (e.g.
  `htmx:config:request`), and attribute inheritance is explicit — follow the
  htmx 4 docs/upgrade guide, never htmx 2 examples. The htmx 4 gzip size is
  measured and counted in the JS budget.

### Server (Go, standard library first)

- `net/http` with the Go 1.22+ `ServeMux` patterns; `html/template` for pages
  and fragments; `embed` for templates, static assets, prompt fixtures and the
  JSON schemas.
- OpenAI Responses API called directly over HTTP (official `openai-go` SDK if
  it supports Responses streaming, strict JSON schema, `prompt_cache_key`,
  prompt cache options, `service_tier`, `reasoning.effort`, `store:false`;
  otherwise a thin hand-written client — builder's call after checking).
  Same env vars: `OPENAI_API_KEY`, `TRANSLATE_MODEL`, `TRANSLATE_REASONING`,
  `TRANSLATE_SERVICE_TIER`, `SPEECH_MODEL`, `SPEECH_VOICE`; same defaults,
  zero retries, same error classification
  (including 429 `insufficient_quota` → budget).
- In-memory LRU (50 entries) keyed exactly like `src/server/cacheKey.ts`
  (model, reasoning, tier, `CACHE_VERSION`, inputs).
- Request cancellation: every OpenAI call uses the request `context.Context`;
  a disconnected client must cancel the upstream request.

### Streaming model

Today the client parses partial JSON (`partial-json`) and renders. In the Go
version **the server owns parsing and rendering**:

1. *(Designer's call.)* One streaming `POST` per translation run, issued by
   htmx 4 (fetch-based) with a `text/event-stream` response. Not
   POST-then-`EventSource`: a GET hand-off would need the same
   instance, a shared store (forbidden for source text) or source text in
   URLs. Aborting the fetch is the cancellation signal. Per-session state
   (previous main for refine, refine rollback snapshots, reply context) lives
   in the page (hidden fields / client memory) and is sent with each run;
   the server stores nothing per user except the result LRU. "UI state on
   the server" means server-rendered, not server-stored.
2. The server reads the OpenAI stream with an incremental JSON tokenizer and
   emits typed events:
   - `source-lang` — the model's reported `sourceLang` as soon as it closes,
     driving the Auto-chip label and auto-swap as today,
   - `main-delta` — text appended to the main translation (plain text, not
     HTML, so the client can append it without re-rendering),
   - `main-ready` — emitted only when the `main` JSON string has closed. A
     partial string is never treated as ready. Copy enables on this event.
   - `text-delta` *(designer's call, for parity)* — explanation-type string
     fields (main explanation, rationale, alternative notes, etc.) stream as
     they are generated, as today, into server-rendered placeholders keyed
     by field path,
   - `detail` fragments — server-rendered HTML for structured parts
     (alternative rows, learning rows with resolved ranges, dictionary
     sections), emitted when each JSON subtree completes,
   - `done` / `error` (classified, user-safe message).
3. Swaps only target the result pane and the reference pane. The source
   textarea, the action dock and the header are never swap targets.
4. The final result is validated against the same strict schema before it is
   cached; a validation failure is an `error` event.

### Async model (the "do more earlier, in parallel" goal)

Free work that moves earlier or runs concurrently on the server:

- **Learning ranges on the server.** `prepareLearningResult` /
  `learningRanges.ts` (exact grapheme-safe ranges for phrases, counterparts,
  grammar annotations) is ported to Go and computed as soon as each
  `learningPhrases` entry completes, in a goroutine, while the rest streams.
  The client receives ready-to-render spans and no longer ships that logic.
- **Fragment rendering concurrently with streaming**: completed subtrees are
  rendered while the model is still generating later fields.
- **Warm-up**: same free `warm` endpoint on focus/visibility (≤ 1 per 2 min),
  and the OpenAI HTTP/2 connection is kept warm in the process.
- **Cache hits** return the whole result as one rendered response with no
  stream setup.

Paid work only happens on an explicit user action (translate run, Listen tap,
refine toggle). No audio pre-generation.

### Client (htmx + small hand-written modules)

htmx drives forms, settings, language chips, refine toggles and fragment
swaps. The following is irreducible client JS, written as small ES modules
without a framework (no build step beyond minification, or none):

- input debounce (800/400ms rules from `debounceFor`), paste-immediate,
  blur-flush, Cmd/Ctrl+Enter, abort of the previous stream on input change,
- client-side language detection for the auto-swap/Auto-chip label: CJK by
  regex on the client; Latin-language disambiguation either on the server
  (Go library or the model's own report) or a tiny client heuristic —
  builder's call, must not reintroduce a large dependency like tinyld,
- streaming-text interpolation (grapheme-boundary, ≤100ms per burst, reduced
  motion shows text directly) — kept, because it is user-visible behaviour,
- Copy (clipboard) + keyboard shortcut, guarded by the current request id,
- Web Audio PCM player for Listen (port of `pcmPlayer.ts`, single active
  playback owner, page-memory LRU of completed audio),
- visualViewport/keyboard handling, layout pending/measurement, fold posture
  (port of `useWorkspaceLayout` / `useFoldLayout`), preferring CSS where
  possible,
- source grammar-underline mirror sync and tap hit-testing, target phrase
  inspection with selection grace period (port of `SourceHighlight` /
  `InspectableTranslation` gesture rules),
- popovers/menus (language "More…", Adjust, Settings) — native `<dialog>` /
  `popover` attribute + CSS anchor positioning where supported, minimal JS
  fallback; no Floating UI,
- view transitions on result completion, respecting reduced motion.

Each module has a documented byte budget; the total stays within the JS target.

### Styling

Tailwind v4 via the standalone CLI (no Node), scanning Go templates and JS
modules, reusing the tokens and type scale from `src/styles.css`. The builder
may carry over `styles.css` rules directly where they are not React-specific.

### Prompts and schemas: shared, language-neutral source (user decision)

Prompts live outside both apps so each consumes them without depending on the
other. New repo-root folder `shared/translation/`:

- `prompts/*.mustache` — every prompt text (language rule, sentence/word
  system, reminders, live-block lines), as Mustache templates,
- `fewshots/*.json` — the few-shot user/assistant pairs,
- `schemas/{sentence,word}.json` — the strict JSON Schemas with their
  descriptions (descriptions are prompt text),
- `i18n/strings.json`, `languages.json`, `limits.json`, `preferences.json`,
  `meta.json` (`cacheVersion`, default model),
- `fixtures/requests.json` — golden OpenAI request bodies.

Each app renders templates with its own maintained Mustache library (JS
`mustache`, Go `github.com/cbroglie/mustache`), HTML escaping disabled. The
branching that `prompts.ts` does today becomes a small set of boolean/string
flags (`isPolish`, `kr`, `isReading`, `autoSource`, tone flags, `metaLang`,
language names, …) computed identically by each app; all wording lives in
the templates. Go cannot `go:embed` outside its module, so a `go generate`
step copies `shared/translation/` into the Go module; CI fails when the copy
is stale.

**Safety net:** before anything moves, golden request bodies are captured
from the current TypeScript app for ~20 representative inputs (every intent ×
tone, polish, reading, auto source, context, refinements, forged block tags,
non-default config). The TypeScript prompts are then migrated to the shared
templates, and the TS app must reproduce every golden body exactly (JSON-equal,
every string identical). The Go app must reproduce the same bodies. The model
therefore sees exactly what it sees today; no `CACHE_VERSION` bump is needed.
Evals' prompt variants become alternative template files. Matching
`prompt_cache_key` lets both apps share OpenAI's prompt cache.

### Preferences

Same `nt.preferences` cookie (version 1 JSON, same validation rules), read on
every request so the first server render is already correct; HTML responses
`private, no-store`, `Vary: Cookie, Accept-Language`. No legacy-localStorage migration bootstrap (user decision: new app, no legacy ports).

### Telemetry

Langfuse tracing (content-free, same allowlist) is ported via OTLP from Go,
after parity — stage 7. Vercel Analytics script kept.

## Deployment

User preference: keep everything on Vercel; Cloudflare Workers rejected (no
native Go). Verified against Vercel docs on 2026-11-02:

- Go runtime is **Beta**. A plain `net/http` server works via the Go
  framework preset (`go.mod` + `main.go`, listens on `PORT`).
- Streaming for Go is **not documented** (docs list Node.js and Python).
- Request cancellation is documented as **Node.js only**.
- Fluid Compute for Go: docs disagree; in-function concurrency is documented
  only for Node.js/Python.

Therefore **stage 0 is a deployment spike** with pass criteria:

1. SSE events flush to the browser incrementally (not buffered until the end),
2. a browser disconnect cancels `r.Context()` within ~1s so the OpenAI
   request is aborted,
3. warm-instance reuse is observable (in-memory LRU survives between requests),
4. cold start TTFB is acceptable (< 500ms target).

If 1 or 2 fails, Vercel cannot host the Go app with parity. The fallback is an
always-on Go server (e.g. Fly.io or Railway) — **that choice goes back to the
user at that point**, it is not pre-decided here.

## Testing

- **New black-box Playwright suite** (stage 1) that drives an app by URL using
  the stable `data-testid` selectors in `AGENTS.md`, with OpenAI and speech
  replaced by a deterministic fake upstream (recorded responses served by a
  local stub; the apps point at it via a base-URL env var) so no paid calls
  happen in tests. It runs against both apps, at the same device sizes as
  today's browser matrix (Chromium + WebKit, folded/unfolded phone, iPhone,
  MacBook). It is also the measurement harness. The current component-level
  `tests/browser` suite stays with the TS app; it cannot drive the Go app.
- Go unit tests: incremental JSON parser, event emission (`main-ready` never on
  a partial string), learning ranges (port the TS test cases), cache keys,
  error classification, prompt fixture parity, cookie validation.
- Small JS module tests where logic is non-trivial (debounce rules,
  grapheme interpolation, gesture grace period).
- The billed smoke scripts get Go equivalents (one real request each, never in
  CI).

## Stages

Each stage ends with its tests green; stages 2 and 7 end with a measurement
report comparing both apps.

**Stage 2 is a go/no-go gate (user decision).** The deciding metrics are page
load (TTFB/FCP/LCP, first typeable) and client JS size. If they are not
clearly better, stop and report before stages 3–7. Time-to-translation is
reported but not decisive (OpenAI dominates it).

**Keyboard behaviour (designer's call, user did not single out a behaviour).**
Stage 1 adds a layout-movement metric: layout shift and main-text position
change during a simulated incremental visualViewport shrink on the phone
profiles, measured on the current app. Stage 7 ports the documented
keyboard behaviours for parity, then shows the user each one in the Go app
before finalising, so any that feel wrong can be dropped on purpose.

0. Vercel Go deployment spike (pass/fail above).
1. Black-box Playwright suite + fake upstream + measurement script, run
   against the current app; record the production baseline.
2. Core: page shell, preferences, language chips, source editor, sentence
   translation streaming, main Copy, alternatives, errors, cache, warm-up,
   cancellation. **First comparison report.**
3. Word mode + dictionary reference.
4. Contextual learning (server-side ranges, phrase rows, underlines, source
   highlight, mobile learning surface).
5. Pronunciation (speech endpoint, PCM player).
6. Refine chips, custom adjustment, reply context, settings/UI language,
   Adjust layout rules.
7. Layouts (workspace/split/stack/fold, keyboard/visualViewport, safe areas),
   telemetry, final comparison report and a replace/keep recommendation.

## Left to the builder

- Incremental JSON parser implementation (on top of `jsontext` where it fits).

**User decision (2026-11-02):** use maintained third-party libraries where
they make sense instead of custom versions — notably the official
`openai-go` SDK (no hand-written client). Chosen by the designer on that
basis: templ for components, `hashicorp/golang-lru/v2`,
`santhosh-tekuri/jsonschema/v6` for final schema validation,
`google/go-cmp` in tests, `@playwright/test` for the black-box suite.
- Template organisation, module structure, CSS port strategy.
- Latin-language detection approach (within the "no large dependency" rule).
- Fake upstream implementation for tests.
