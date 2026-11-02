# Go + htmx rewrite — Stages 0–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Go can stream on Vercel, build a black-box test and measurement harness that runs against both apps, and ship the Go + htmx core (sentence/word translation streaming, Copy, preferences, language chips) far enough to make the stage 2 go/no-go comparison.

**Architecture:** A Go 1.27 `net/http` server in `go/` (Vercel Go framework preset) renders pages with templ and answers each translation run with one streaming POST whose `text/event-stream` body carries named events (text deltas, readiness) and unnamed `<hx-partial>` HTML swaps that htmx 4 applies. Prompts (Mustache templates), few-shots, schemas, UI strings and limits live in a language-neutral `shared/translation/` folder that both apps render with their own Mustache library; golden request bodies prove both send OpenAI identical requests. A fake OpenAI server makes every test free and deterministic for both apps.

**Tech Stack:** Go 1.27 (`net/http`, `encoding/json/v2`, `iter`), `github.com/openai/openai-go/v3`, `github.com/a-h/templ`, `github.com/hashicorp/golang-lru/v2`, `github.com/santhosh-tekuri/jsonschema/v6`, `github.com/google/go-cmp`, `github.com/cbroglie/mustache` (Go) and `mustache` (JS), htmx 4.0.x (self-hosted), Tailwind v4 standalone CLI, Playwright (`@playwright/test`), mise for the Go/templ/tailwind toolchain.

**Spec:** `docs/superpowers/specs/2026-11-02-go-htmx-rewrite-design.md`. Stages 3–7 get their own plan only if the stage 2 gate passes.

## Global Constraints

- `go.mod`: `go 1.27`. Use current APIs (`encoding/json/v2`, `iter.Seq2`, `ServeMux` method patterns); confirm details with context7 (`/golang/go/go1.27.3`, `/golang/website`), never memory.
- htmx **4.0.x**, pinned exact version, self-hosted under `go/web/static/vendor/`. Follow htmx 4 docs (`/bigskysoftware/htmx/v4.0.0`): fetch-based, SSE from any method, `<hx-partial>`, named SSE events dispatch DOM events, `htmx:abort`, `hx-sync`, new event names (`htmx:config:request`, `event.detail.ctx`), explicit inheritance. Never copy htmx 2 examples.
- **Prefer maintained third-party libraries over custom code** (user instruction). Hand-write only what no maintained library does well; each such module says why in its doc comment.
- No change to model, reasoning, tier, prompt content, schema or few-shots. Prompts move to `shared/translation/` (user decision) with content unchanged, proven by the golden request bodies. Same env vars and defaults: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (tests), `TRANSLATE_MODEL` (default `gpt-6.1-terra`, strip leading `openai/`, must match `^[a-z0-9][a-z0-9._-]*$`i), `TRANSLATE_REASONING` (`none|low|medium`, default `none`), `TRANSLATE_SERVICE_TIER` (`default|fast`, default `fast`).
- Zero retries (`option.WithMaxRetries(0)`), `store:false`, no fallback model, no speculative paid work.
- Limits: source 4000 chars, context 1000, ≤3 refinements of ≤200 chars each.
- Client debounce: 800ms, 400ms when text ends with `/(?:[.!?…。！？~～]|\p{Extended_Pictographic}[\p{Emoji_Modifier}️]*)['"’”)\]」』]*$/u`; paste runs immediately; blur flushes; Cmd/Ctrl+Enter forces; Enter/Shift+Enter insert newlines. Warm-up ≤ once per 2 minutes.
- Translation LRU: 50 entries; key includes cache version, model, reasoning, tier.
- Source textarea is **never** inside a swap target. Main text deltas are inserted as text, never HTML.
- HTML responses: `Cache-Control: private, no-store`, `Vary: Cookie, Accept-Language`. Hashed static assets: `public, max-age=31536000, immutable`.
- Never log, store or send to telemetry: source text, context, refinements, prompts, outputs, raw provider errors (`openai.Error.RawJSON`/dumps).
- Tests never make paid calls. Anything billed (live measurement, smoke) requires the user's go-ahead at run time.
- Client JS budget for the finished app: ≤ 40 KB gzip including htmx.
- Commands: Go/templ/tailwind via mise in `go/`; TypeScript side keeps npm (project rule). Deploying or creating a Vercel project is outward-facing: ask the user first.

## Review Focus

1. **Korean IME composition while a run streams** — typing Hangul (composition events, partial jamo) must never lose characters, move the caret, or fire the 400ms path; result swaps never touch the textarea. Test in Task 11.
2. **JSON escapes split across OpenAI deltas** — `\"`, `\\`, `\n`, and surrogate pairs `😀` broken across chunk boundaries must yield exact text and a correct `main-ready` moment. Test in Task 7.
3. **Late events from a superseded run** — after the user edits mid-stream, events from the aborted run (already in flight) must not touch the new result or enable Copy. Test in Task 11.
4. **Markup in model output or source** — `<img src=x onerror=…>` / `</textarea>` in `main`, `rationale` or alternatives renders as literal text everywhere. Test in Task 10.
5. **Buffered SSE on the deployed platform** — Vercel/proxy compression or buffering would turn streaming into one late blob; deltas must arrive incrementally on the real deployment. Tests in Task 1 (spike) and Task 13 (real endpoint).

---

## File structure

```
go/
  go.mod, go.sum, mise.toml, vercel.json, Makefile, README.md
  main.go                         entry: config, routes, ListenAndServe(":"+PORT)
  internal/config/                env → Translate config
  internal/contract/              go:embed copy of shared/translation (go generate)
  internal/prefs/                 nt.preferences cookie parse/serialize
  internal/prompt/                TranslateInput, validation, live text, request body, cache keys
  internal/jsonstream/            incremental JSON scanner (string deltas, value ends)
  internal/llm/                   openai-go wrapper: stream text deltas, classify errors
  internal/translate/             /translate + /warm handlers, LRU, SSE writer, result validation
  internal/web/                   page handler, static assets, templ components (*.templ + generated)
  web/static/js/                  app.js, composer.js, stream.js, copy.js, prefs.js (+ *.test.js)
  web/static/css/                 input.css (Tailwind source), app.css (generated, committed)
  web/static/vendor/htmx.min.js
  cmd/fakeopenai/                 fake Responses API for tests
  cmd/spikecheck/                 stage 0 deployment checker
shared/translation/               prompts, few-shots, schemas, strings, golden requests (source of truth)
scripts/capture-request-fixtures.ts
e2e/
  playwright.config.ts, fixtures/results/*.json, tests/core.spec.ts, perf/measure.ts
docs/superpowers/reports/         spike, baseline and stage 2 comparison reports
.github/workflows/go.yml
```

---

## Stage 0 — deployment spike

### Task 1: Vercel Go streaming and cancellation spike

**Files:**
- Create: `go/go.mod`, `go/mise.toml`, `go/vercel.json`, `go/main.go`, `go/cmd/spikecheck/main.go`, `docs/superpowers/reports/2026-11-xx-vercel-go-spike.md`

**Interfaces:**
- Produces: the `go/` module (`module neotranslate`), the Vercel project config, and a pass/fail report that gates every later task.

- [ ] **Step 1: Toolchain.** `cd go && mise use go@1.27` (also `templ` and `tailwindcss` 4.3.3 entries for later tasks); `go mod init neotranslate`; `go.mod` says `go 1.27`. `vercel.json`: `{"framework": "go"}`.
- [ ] **Step 2: Spike server in `main.go`.** Listens on `PORT` (default 3000). Routes:
  - `GET /spike/stream?n=50&ms=100` — SSE (`Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`), writes `data: <i> <unixMillis>\n\n` and flushes every `ms`; on `r.Context().Done()` records the cancel time and returns.
  - `GET /spike/stats` — JSON `{instance: <random id fixed at boot>, served: <count>, lastCancelAt: <unixMillis>, bootAt}`.
  - `POST /spike/stream` — same as GET, proving POST SSE.
- [ ] **Step 3: `cmd/spikecheck`** takes `-url`. Checks, printing PASS/FAIL each:
  1. incremental: ≥ 40 of 50 events arrive ≥ 50ms apart client-side (not one burst),
  2. cancellation: open stream, close after 1s, poll `/spike/stats`; `lastCancelAt` within 1500ms of close,
  3. reuse: 5 sequential `/spike/stats` calls, report distinct `instance` ids and `served` growth,
  4. cold TTFB: first request after ≥ 15 min idle (run manually, record number) < 500ms target,
  5. POST variant passes check 1.
- [ ] **Step 3b: htmx 4 protocol spike.** `GET /spike/page` serves a static page with htmx 4 (self-hosted) and a form `hx-post="/spike/htmx" hx-trigger="submit" hx-sync="this:replace" hx-swap="none"`. `POST /spike/htmx` streams `text/event-stream`: two unnamed `<hx-partial hx-target=… hx-swap=…>` messages 300 ms apart and two named events (`nt-main-delta`, `nt-main-ready`) with JSON data. Drive it with the `playwright` package already installed (script `go/cmd/spikecheck/htmx.mjs`). Record in the report: (a) partials land incrementally with `hx-swap="none"` on the form, (b) which element receives the named events and that `event.detail` exposes the data, (c) `htmx.trigger(form, 'htmx:abort')` and a second submit under `hx-sync="this:replace"` each close the fetch so the server sees `ctx.Done()` within ~1 s, (d) htmx 4 gzip size against the 40 KB budget. If the plain-form POST path fails (a)–(c), choose the documented alternative (e.g. `hx-sse:connect` with POST values) here, update the event contract in Tasks 10–11 before they start, and note it in the report.
- [ ] **Step 4: Local run.** `go run . &` then `go run ./cmd/spikecheck -url http://localhost:3000` → checks 1, 2, 3, 5 PASS; `node go/cmd/spikecheck/htmx.mjs http://localhost:3000` → (a)–(c) PASS.
- [ ] **Step 5: Ask the user** to create/link a separate Vercel project with root directory `go/` and deploy a preview. Then run spikecheck and `htmx.mjs` against the preview URL.
- [ ] **Step 6: Report.** Write the report with raw numbers. **If check 1 or 2 fails, stop and bring the fallback-host decision to the user** (spec "Deployment"). Otherwise continue.
- [ ] **Step 7: Commit** (`feat(go): vercel streaming spike`).

---

## Stage 1 — shared contract, fake upstream, black-box tests, baseline

### Task 2: Shared translation package and TypeScript migration

**Files:**
- Create: `shared/translation/{prompts/*.mustache,fewshots/*.json,schemas/sentence.json,schemas/word.json,i18n/strings.json,languages.json,limits.json,preferences.json,meta.json,fixtures/requests.json,README.md}`, `scripts/capture-request-fixtures.ts`, `src/server/sharedPrompts.test.ts`, `go/cmd/syncshared/main.go`, `go/internal/contract/data/` (generated copy)
- Modify: `src/server/prompts.ts`, `src/server/schemas.ts`, `src/server/learningTypes.ts` (result schema parts), `src/server/cacheKey.ts` (`CACHE_VERSION` from `meta.json`), `src/lib/i18n.ts`, `src/lib/languages.ts`, `src/lib/limits.ts`, `src/lib/preferences.ts` (rules), `evals/promptVariants.ts`, `package.json` (dependency `mustache` + `@types/mustache`; script `fixtures:capture`)

**Interfaces:**
- Produces: the `shared/translation/` layout in the spec; `fixtures/requests.json` = `[{name, input: TranslateInputData, config: {model, reasoning, serviceTier}, body}]` where `body` is the exact JSON the AI SDK sends to `POST /v1/responses`. Fixture inputs (≥ 20): each intent × tone, polish (source==target), reading (target==uiLang), `auto` source, every uiLang, context, 1–3 refinements with previousMain, word + refinements (ignored), forged `</source>`/`<context>` tags, non-default config (`reasoning: low`, `serviceTier: default`).
- Produces: the prompt flag set, documented in `shared/translation/README.md` (name, type, exact definition, e.g. `isPolish = source === target`, `kr = source === 'ko' || target === 'ko'`, `isReading = target === uiLang && source !== uiLang`, `pairInvolvesForeign` as in `prompts.ts`). Task 8 implements the same flags in Go from this README.
- Produces: `go generate ./...` in `go/` copies `../shared/translation/` to `go/internal/contract/data/` (`//go:generate go run ./cmd/syncshared`), deterministic, committed.
- [ ] **Step 1: Capture goldens from the unchanged app.** `scripts/capture-request-fixtures.ts`: replace `globalThis.fetch`, call `streamText(translationRequest(data, config))`, record `JSON.parse(init.body)`, return a `400` so no network call happens. Write `fixtures/requests.json`. Commit this alone (`test: capture golden OpenAI request bodies`) before touching prompts.
- [ ] **Step 2: Golden test.** `sharedPrompts.test.ts`: for each fixture, the captured body of `translationRequest(fixture.input, fixture.config)` `toEqual`s `fixture.body`. Run `npx vitest run src/server/sharedPrompts.test.ts` → PASS (baseline).
- [ ] **Step 3: Move data.** Strings, languages, limits, preference rules, `CACHE_VERSION`/default model, few-shots and schemas move into `shared/translation/`; TS imports the JSON (keep exported names/types so call sites do not change). Result schemas: load the JSON Schema and build the zod schema with `z.fromJSONSchema` (present in the installed zod) so `Output.object` still validates strictly and types still infer; if it cannot round-trip descriptions/strictness into an identical request schema, use the AI SDK `jsonSchema()` helper with `ajv` validation and types generated by `json-schema-to-typescript` (committed). Golden test still PASS.
- [ ] **Step 4: Move prompt text to templates.** `prompts.ts` keeps its exported functions and signatures but builds text via `Mustache.render(template, flags, partials, {escape: (s) => s})`; `liveText`, `userBlocks`, `sourceBlock` stay code (they process live input). `evals/promptVariants.ts` variants become `shared/translation/prompts/variants/*.mustache`. Golden test PASS; `npm test`, `npm run typecheck`, `npm run lint` PASS.
- [ ] **Step 5: Go copy step.** Write `cmd/syncshared`; `cd go && go generate ./...` produces `internal/contract/data/`; running it twice yields no diff.
- [ ] **Step 6: Commit** (`refactor: move prompts, schemas and strings to shared/translation`).

### Task 3: Fake OpenAI Responses server

**Files:**
- Create: `go/internal/fakeopenai/fake.go` (`fakeopenai.Handler(fixturesDir string) http.Handler`), `go/internal/fakeopenai/fake_test.go`, `go/cmd/fakeopenai/main.go` (thin main), `e2e/fixtures/results/*.json`, `e2e/fakeUpstream.test.ts`

**Interfaces:**
- Produces: `go run ./cmd/fakeopenai -addr 127.0.0.1:3901 -fixtures ../e2e/fixtures/results` serving:
  - `POST /v1/responses` — picks the fixture whose `match` string occurs in the request's last user text part (else `default.json`); streams Responses API SSE (`response.created`, `response.output_text.delta` × N, `response.completed` with usage) where the deltas are the fixture's `result` serialized as JSON and split every `chunk` runes (rune boundaries, never mid-UTF-8; default 12, fixture-overridable; splits deliberately fall inside `\"` and `\uXXXX` escapes) with `delayMs` between chunks (default 20). Fixture `error: {status, body}` returns that error instead (e.g. 429 `{"error":{"code":"insufficient_quota"}}`).
  - `GET /_stats` → `{requests, aborted, lastBodies: [last 5 request bodies]}`; `POST /_reset`.
- Fixture file shape: `{"match": "...", "intent": "sentence"|"word", "chunk": 12, "delayMs": 20, "result": {...}|null, "error": {...}|null}`. Results are synthetic (never real user text) and include: plain EN→KO, KO→EN reading, word, markup-in-output (`<img src=x onerror=alert(1)>` in main and rationale), emoji/surrogates, long slow (`delayMs` 200, for cancellation), each error kind.
- [ ] **Step 1: Failing Go test** `TestStreamsFixtureAsResponsesSSE`: concatenated `output_text.delta` payloads equal `json.Marshal(result)`; `TestAbortCounted`: cancel client ctx mid-stream → `/_stats.aborted == 1`.
- [ ] **Step 2: Failing TS test** `fakeUpstream.test.ts` (proves the SSE format is what the AI SDK accepts): with `OPENAI_BASE_URL=http://127.0.0.1:3901/v1`, `OPENAI_API_KEY=test`, `streamText(translationRequest(...))` `output` deep-equals the fixture result; the 429 insufficient_quota fixture makes `classifyTranslationError` return `'budget'`.
- [ ] **Step 3: Implement**; check exact Responses event shapes against context7 `/openai/openai-go/v3.86.0` (its typed stream events) or the OpenAI API reference.
- [ ] **Step 4: Run** `go test ./internal/fakeopenai/` and `npx vitest run e2e/fakeUpstream.test.ts` → PASS.
- [ ] **Step 5: Commit.**

### Task 4: Black-box Playwright core suite (green on the current app)

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/tests/core.spec.ts`, `e2e/tests/helpers.ts`
- Modify: `package.json` (devDependency `@playwright/test` pinned to the installed `playwright` 1.64.1; scripts `e2e`, `e2e:ts`, `e2e:go`)

**Interfaces:**
- Consumes: Task 3 fake upstream.
- Produces: `APP=ts|go npx playwright test -c e2e` — webServers: fake upstream on 3901, and either the TS app (`npm run dev -- --port 3100` with `OPENAI_BASE_URL`/`OPENAI_API_KEY=test`) or the Go app (`cd go && go run .` with `PORT=3200` and the same env). Projects: Chromium + WebKit at the nine viewport/device profiles in `vitest.browser.config.ts`. Tests use only `data-testid`/ARIA selectors from `AGENTS.md`, plus `[data-testid="main-translation"]`, `[data-testid="output-toolbar"] [data-testid="copy-button"]` (add `data-testid="copy-button"` to `src/components/CopyButton.tsx` — the only TS app change allowed), `[data-testid="alternative-item"]`, and `/_stats` of the fake.
- [ ] **Step 1: Write tests (tag `@core`)**, each asserting user-visible behaviour:
  - `streams main then details`: type the EN→KO fixture text; main text grows across ≥ 2 observations before it is complete; final text equals fixture `main`.
  - `copy enables at main-ready before done`: slow fixture; Copy enabled while rationale still incomplete; clipboard equals trimmed main.
  - `stale result disables copy`: after result, edit text → Copy disabled until the new result's main is ready.
  - `paste runs immediately`, `blur flushes`, `cmd+enter forces`, `enter inserts newline`: assert request timing via `/_stats.requests` and textarea value.
  - `editing mid-stream cancels upstream`: slow fixture, edit after first delta → `/_stats.aborted` increments within 2s; final result is the new text's.
  - `repeat is served from cache`: same input twice (Clear, retype) → `/_stats.requests` unchanged second time.
  - `error kinds are localized`: each error fixture shows the `STRINGS[uiLang]` message for en and ko.
  - `textarea survives streaming and UI language switch`: store `window.__ta = textarea`; after a full result and a UI language switch, the same node is in the DOM with the same value and caret.
  - `preferences persist`: change tone, target chip, UI language → reload → same selections (cookie).
  - `auto source flips target`: source auto, target en, type English fixture → target becomes ko before the request (`lastBodies` contains target ko).
  - `more languages listbox`: open `lang-more-trigger`, pick `fr` → becomes recent chip, persists on reload.
  - `markup renders as text`: markup fixture → no `img` element inside the result; literal text visible.
  - `word input uses word intent`: `thanks` → request body has the word schema name; main shows `primaryTranslation`.
- [ ] **Step 2: Run** `APP=ts npx playwright test -c e2e --grep @core` → PASS on the current app (it defines parity). Fix tests, not the app, unless the app is genuinely wrong (then report to the user).
- [ ] **Step 3: Commit.**

### Task 5: Measurement harness and baseline

**Files:**
- Create: `e2e/perf/measure.ts`, `docs/superpowers/reports/2026-11-xx-baseline.md`

**Interfaces:**
- Produces: `npx tsx e2e/perf/measure.ts --app ts|go --url <base> [--fake | --live --i-understand-this-is-billed] --runs 10 --out <json>` and a markdown table writer used again in Task 13.
- Metrics (median and p90 per device profile: iPhone WebKit 3G-fast throttled, Pixel Chromium 4× CPU, MacBook Chromium): TTFB, FCP, LCP, TBT, transferred JS bytes (raw+gzip), CSS bytes, first-typeable (textarea focusable + `input` accepted, measured by typing a char and seeing it), last keystroke → first main character visible, → Copy enabled, → done; cold vs warm TTFB; **layout movement** during a simulated keyboard open (incremental `visualViewport` shrink using the technique in `tests/browser/mobile.browser.tsx`): CLS during the shrink and the main text's y-position change.
- [ ] **Step 1:** Implement; `--fake` runs against local servers with the fake upstream; `--live` refuses without the flag and prints the number of billed requests first.
- [ ] **Step 2:** Run `--fake` for `ts` → JSON + table. Ask the user before `--live` against production; record both in the baseline report with the date and commit hash.
- [ ] **Step 3: Commit.**

---

## Stage 2 — Go core

### Task 6: Config, contract loader, preferences

**Files:**
- Create: `go/internal/config/config.go`, `config_test.go`; `go/internal/contract/contract.go`, `contract_test.go`; `go/internal/prefs/prefs.go`, `prefs_test.go`

**Interfaces:**
- Produces:
  - `config.LoadTranslate(getenv func(string) string) (config.Translate, error)`; `type Translate struct{ Model, Reasoning, ServiceTier string }`; `(Translate) Label() string` = `model:reasoning:tier`; `var ErrConfiguration`.
  - `contract.Load() (*contract.Contract, error)` from `//go:embed all:data`. `Contract{ Strings map[string]map[string]string; Languages []Language; Limits Limits; CacheVersion, DefaultModel string; Prefs PrefRules; Templates map[string]*mustache.Template; Fewshots map[string]Fewshot; Schemas map[string][]byte }`; `(*Contract) T(uiLang, key string) string`.
  - `prefs.Parse(r *http.Request, rules contract.PrefRules) prefs.Snapshot`; `prefs.Cookie(p prefs.Preferences, secure bool) *http.Cookie`; `Preferences{Source, Target, Mode, UILang string; RecentSource, RecentTarget *string}`; defaults from `Accept-Language` exactly as `defaultPreferences` in `src/lib/preferences.ts`.
- [ ] **Step 1: Failing tests:** config cases from `src/server/openai.test.ts` (default model, `openai/` strip, invalid model id, invalid enums → `ErrConfiguration`); contract: every template parses, every few-shot and schema loads, `CacheVersion` equals `shared/translation/meta.json`; prefs: port every case in `src/lib/preferences.test.ts` that concerns cookie validation and defaults (the localStorage migration cases are out of scope until stage 6).
- [ ] **Step 2: Run** `cd go && go test ./internal/config/ ./internal/contract/ ./internal/prefs/` → FAIL.
- [ ] **Step 3: Implement** (decode with `encoding/json/v2`; cookie value is URL-encoded JSON `{"version":1,...}` identical to the TS writer so both apps read each other's cookie).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit.**

### Task 7: Incremental JSON scanner

**Files:**
- Create: `go/internal/jsonstream/scanner.go`, `scanner_test.go`

Why custom: `jsontext.Decoder` only yields a string token once it closes, and no maintained Go library emits partial string contents with their JSON path; this ~200-line scanner does only that. Final validation still uses libraries (Task 10).

**Interfaces:**
- Produces:
  - `type Seg struct{ Key string; Index int; IsIndex bool }`; `type Path []Seg`; `(Path) String() string` → `alternatives[0].note`.
  - `type Kind int` with `StringChunk`, `StringEnd`, `ValueEnd`.
  - `type Event struct{ Path Path; Kind Kind; Text string; Raw []byte }` — `StringChunk.Text` is decoded text appended since the last chunk for that string; `StringEnd` fires when a string value closes (`Text` = full decoded value); `ValueEnd` fires for every completed value (objects/arrays/scalars) with its raw JSON.
  - `func New() *Scanner`; `(*Scanner) Feed(chunk string) ([]Event, error)`; `(*Scanner) Close() error` (error if the document is incomplete).
- [ ] **Step 1: Failing tests:** `TestMainChunksThenEnd` (`{"sourceLang":"en","main":"안녕` + `하세요"}` → chunks `안녕`,`하세요`, then `StringEnd main` only after the closing quote); `TestEscapesSplitAcrossFeeds` (feed `"a\` | `"b\u00` | `e9\uD83D` | `\uDE00"` byte-by-byte and in random splits → `a"bé😀` exactly); `TestValueEndForArrayItems` (`alternatives[0]` ValueEnd Raw unmarshals to the item); `TestNoReadyOnPartial` (stream ending inside `main` → no `StringEnd`, `Close()` errors); `TestScalarsAndWhitespace`.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS) with `go test ./internal/jsonstream/ -run . -count=1`; add a `FuzzFeedSplits` fuzz target asserting any split of a valid document yields identical events to a single feed.
- [ ] **Step 5: Commit.**

### Task 8: Prompt request builder and cache keys

**Files:**
- Create: `go/internal/prompt/input.go`, `request.go`, `cachekey.go`, `*_test.go`

**Interfaces:**
- Consumes: `contract.Contract` (templates, few-shots, schemas, cache version), `config.Translate`, the flag definitions in `shared/translation/README.md` (Task 2).
- Produces:
  - `type TranslateInput struct{ Text, Source, Target, Mode, Intent, UILang, Context, PreviousMain string; Refinements []string }`; `(TranslateInput) Validate(l contract.Limits) error` (limits, enums, `Text` non-empty).
  - `LiveText(s string) string` — port of `liveText` (`/<(\s*\/?\s*(?:source|context|adjustments)\b[^<>]*)>/gi` → `‹$1›`).
  - `LiveInput(in TranslateInput) string` — `userBlocks + sourceBlock` exactly as `src/server/prompts.ts:105-123`; word intent passes only context.
  - `Flags(in TranslateInput) map[string]any` — exactly the flag set documented in `shared/translation/README.md`.
  - `BuildRequest(c *contract.Contract, in TranslateInput, cfg config.Translate) ([]byte, error)` — renders the templates with `Flags(in)` (escaping disabled), assembles messages, schema, `prompt_cache_key` (`nt:<cacheVersion>:<intent>:<uiLang>:<source>:<target>:<mode>`), cache options, reasoning, tier and `store:false` into the Responses body shape shown by the golden fixtures. Use `openai-go` `responses.ResponseNewParams` where its typed fields express the shape; use its extra-fields mechanism only for fields it lacks (e.g. the prompt-cache breakpoint on the stable reminder part).
  - `CacheKey(in TranslateInput, cacheVersion, configLabel string) string` — same fields/semantics as `cacheKeyFor` (trimmed text/context, word ignores refinements, previousMain only when refinements exist); need not be byte-equal to TS.
- [ ] **Step 1: Failing tests:** `TestBuildRequestMatchesFixtures` — for each `shared/translation/fixtures/requests.json` entry, `BuildRequest` output is JSON-equal to `body` (`cmp.Diff` on decoded `any`); `TestLiveTextNeutralisesForgedTags`; cache-key cases ported from `src/server/cacheKey.test.ts`; `TestValidateLimits` (4001-char text, 1001-char context, 4 refinements, 201-char refinement → errors).
- [ ] **Step 2–4:** run → implement → `go test ./internal/prompt/` PASS.
- [ ] **Step 5: Commit.**

### Task 9: OpenAI client wrapper

**Files:**
- Create: `go/internal/llm/llm.go`, `llm_test.go`

**Interfaces:**
- Produces:
  - `type Client struct{...}`; `llm.New(getenv func(string) string) *Client` — `openai.NewClient(option.WithMaxRetries(0), option.WithBaseURL(OPENAI_BASE_URL if set))`, API key read per request; a missing key yields `KindConfiguration` at call time.
  - `(*Client) StreamText(ctx context.Context, body []byte) iter.Seq2[string, error]` — `client.Responses.NewStreaming(ctx, responses.ResponseNewParams{}, option.WithRequestBody("application/json", body))` (verify the raw-body option name in context7 `/openai/openai-go/v3.86.0`; if absent use the SDK's documented raw/override mechanism — do not hand-roll HTTP/SSE parsing); yields `response.output_text.delta` text; stops on ctx cancel.
  - `type Kind string` = `configuration|authentication|budget|rate_limit|model_configuration|structured_output|provider`; `Classify(err error) Kind` via `errors.As(err, &*openai.Error)`: 401/403 authentication, 402 budget, 429 + `insufficient_quota` in the error code → budget else rate_limit, 400/404 model_configuration, else provider.
- [ ] **Step 1: Failing tests** against `httptest.NewServer(fakeopenai.Handler(...))` from Task 3: deltas concatenate to the fixture JSON; each error fixture → expected `Kind`; ctx cancel after first delta → fake `aborted == 1`; no retry on 429 (fake `requests == 1`).
- [ ] **Step 2–4:** run → implement → `go test ./internal/llm/` PASS. **Step 5: Commit.**

### Task 10: `/translate` and `/warm` handlers with SSE events

**Files:**
- Create: `go/internal/translate/{handler.go,events.go,result.go,handler_test.go}`, `go/internal/web/result.templ` (result fragments)

**Interfaces:**
- Consumes: Tasks 6, 7, 8, 9.
- Produces:
  - `translate.NewServer(c *contract.Contract, cfg config.Translate, llm *llm.Client) *translate.Server` with `HandleTranslate` (`POST /translate`) and `HandleWarm` (`POST /warm`, 204, no OpenAI call).
  - Form fields: `run` (client UUID), `text`, `source`, `target`, `mode`, `intent`, `uiLang`, `context`, `refinements` (repeated), `previousMain`.
  - Response `text/event-stream` (+ `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`). Named events, JSON data, every payload carries `run`:
    - `nt-source-lang` `{run, lang}` on `StringEnd sourceLang`,
    - `nt-main-delta` `{run, text}` on `StringChunk main` (sentence) / `primaryTranslation` (word),
    - `nt-main-ready` `{run, main}` on the matching `StringEnd` (trimmed),
    - `nt-text-delta` `{run, field, text}` for `rationale`, `formalityNote` (sentence) and `primaryUsageNote` (word),
    - `nt-done` `{run}`, `nt-error` `{run, kind, message}` (message = localized `STRINGS` entry, same mapping as `publicTranslationError`).
  - Unnamed messages: `<hx-partial hx-target="#result-details" hx-swap="innerHTML">` reset at run start (templ `ResultSkeleton`), and one `<hx-partial hx-target="#alternatives" hx-swap="beforeend">` per completed `alternatives[i]` / `alternativeTranslations[i]` (templ `AlternativeRow`). Multi-line HTML is split into one `data:` line per line.
  - Final document: validated with `santhosh-tekuri/jsonschema/v6` against the embedded `schema-<intent>.json`; failure → `nt-error` kind `structured_output`; success → stored in `golang-lru/v2` (size 50) under `prompt.CacheKey`.
  - Cache hit: same event sequence emitted at once from the stored result, no OpenAI call.
  - Client disconnect cancels the OpenAI stream (ctx); nothing is logged about content.
- [ ] **Step 1: Failing tests** (fake upstream via `httptest`): `TestEventOrder` (`nt-source-lang` before first `nt-main-delta`; `nt-main-ready` before any `learningPhrases` value completes in the fixture; `nt-done` last); `TestCacheHitNoUpstream`; `TestErrorLocalized` (ko message for `uiLang=ko`, 429 insufficient_quota → `budget`); `TestDisconnectCancels`; `TestMarkupEscaped` (markup fixture: partials contain `&lt;img`, and `nt-main-delta` JSON text holds the raw string for `textContent` insertion); `TestInvalidInput400` (limits).
- [ ] **Step 2–4:** run → implement → `go test ./internal/translate/` PASS. **Step 5: Commit.**

### Task 11: Page shell, styles and client modules

**Files:**
- Create: `go/internal/web/{page.go,static.go,layout.templ,composer.templ,chips.templ,header.templ}`, `go/web/static/css/input.css`, `go/web/static/css/app.css` (generated), `go/web/static/vendor/htmx.min.js`, `go/web/static/js/{app.js,composer.js,stream.js,copy.js,prefs.js}` + `*.test.js`, `go/Makefile`, `go/main.go` (replace spike routes; keep `/spike/*` only behind `NT_SPIKE=1`)

**Interfaces:**
- Consumes: Tasks 6 and 10.
- Produces:
  - `GET /` server-renders the full page from `prefs.Parse` (no client-only first paint): header (title, Tone, Settings with UI language), source pane (language chip bar + More listbox, textarea `[data-testid="input-textarea"]`, Paste/Clear, count), result pane (target chip bar, `#main-translation` `[data-testid="main-translation"]`, `#explanation-rationale`, `#explanation-formality`, `#result-details` > `#alternatives` (each `AlternativeRow` is `[data-testid="alternative-item"]` with its own Copy; Listen arrives in stage 5), `#result-error` (`role="alert"`, filled from `nt-error`), `[data-testid="output-toolbar"]` with Copy). Word results put `primaryUsageNote` deltas into `#explanation-rationale`, as the current app does. Same `data-testid`s and ARIA labels as `AGENTS.md`. Desktop workspace (≥ 1100px usable width, source left/result right) and compact stacked (result first, composer below) via CSS container queries; fold/split/keyboard handling is stage 7.
  - The form `#translate-form` (`hx-post="/translate" hx-trigger="nt-run" hx-sync="this:replace" hx-swap="none"`; confirm attribute semantics in htmx 4 docs) wraps hidden inputs `run`, `intent`, `refinements`, `previousMain`; the textarea is inside the form but outside every swap target.
  - UI language/tone/chip changes: `prefs.js` writes the cookie synchronously, then `hx-post="/prefs"` returns `<hx-partial>`s for the header, chip bars and labels (morph swap; never the textarea); the textarea's placeholder/aria-label are updated from the response by `prefs.js`. Tone or language change re-runs the translation.
  - JS modules (ES modules, no bundler; `app.js` imports the rest; minified at build only if it saves > 10%):
    - `composer.js`: `debounceFor(text, ms)`, `detectIntent(text)` (port of `src/lib/detectIntent.ts`), `detectLanguage(text)` (CJK regex as `src/lib/detectLanguage.ts`; for Latin text use `tinyld/light` restricted to en/fr/es vendored as ESM **only if** ≤ 10 KB gzip, otherwise return `en` and let `nt-source-lang` correct the label), `resolveTarget({source, target, detected})`, run scheduling (debounce, paste-immediate, blur-flush, Cmd/Ctrl+Enter, IME: never schedule on `compositionupdate`, schedule on `compositionend`), abort via `htmx.trigger(form, 'htmx:abort')` on input change, warm `POST /warm` on `focusin`/`visibilitychange` ≤ once per 120 s, new `run` UUID per run.
    - `stream.js`: listens for `nt-*` events, ignores any whose `run` ≠ current run; appends main text with `textContent` via an interpolator (`Intl.Segmenter` graphemes, ≤ 100 ms per burst, flush on `nt-main-ready`/`nt-done`/focus/pointer selection/visibility; reduced motion → direct); explanation deltas likewise.
    - `copy.js`: Copy button + Cmd/Ctrl+Shift+C shortcut; also port the other shortcuts from `src/hooks/useTranslatorShortcuts.ts` into `composer.js` (Cmd/Ctrl+Enter force, Cmd/Ctrl+K focus input, Escape clears when there is input), enabled only when `mainReady` and the result's request key (`requestKey(req)` = port of `translationRequestKey`) equals the current inputs' key.
    - `prefs.js`: `writePrefsCookie(p)`, chip bar/More listbox (native `popover` + CSS anchor positioning; small JS fallback), recent chip promotion.
  - CSS: Tailwind v4 standalone, `input.css` imports the tokens/type scale from `src/styles.css` and the rules needed for these components; `make css` regenerates `app.css`; `make templ` runs `templ generate`; generated files are committed and CI checks they are fresh.
  - Static: `/static/<name>.<hash>.<ext>` served from `embed.FS` with immutable caching; templ helper `asset("app.js")` resolves hashed URLs.
- [ ] **Step 1: Failing JS unit tests** (`node --test go/web/static/js/`): `debounceFor` cases from `src/hooks/useTranslate.test.tsx` (sentence-final, emoji, closing quote, trailing space, jamo); `detectIntent` cases; `detectLanguage` cases from `src/lib/detectLanguage.test.ts` (any case dropped because tinyld is not used must be listed in the README); `resolveTarget` cases from `src/lib/resolveTranslationTarget.test.ts`; interpolator emits whole graphemes only.
- [ ] **Step 2: Add Review-Focus e2e tests to `e2e/tests/core.spec.ts`** (run on both apps): `IME composition is not interrupted` (Chromium: CDP `Input.imeSetComposition` Hangul sequence while a slow fixture streams → final value exact, caret at end, no request until `compositionend`); `late events from superseded run are ignored` (slow fixture, edit mid-stream, assert main never shows the old fixture text after the edit and Copy stays disabled until the new main-ready).
- [ ] **Step 3: Implement.** Then `APP=go npx playwright test -c e2e --grep @core` and `APP=ts …` both PASS; `go test ./...` PASS; `node --test go/web/static/js/` PASS.
- [ ] **Step 4: Budget check:** `make size` prints gzip bytes of all JS served by `/` (htmx included) and fails above 40 KB.
- [ ] **Step 5: Commit.**

### Task 12: CI for the Go app

**Files:**
- Create: `.github/workflows/go.yml`

- [ ] **Step 1:** Job: setup mise (`go/mise.toml`), `go vet ./...`, `go test ./...`, `templ generate` + `make css` + `git diff --exit-code`, `go generate ./... && git diff --exit-code` (shared copy fresh), `npm ci && npx vitest run src/server/sharedPrompts.test.ts`, `node --test go/web/static/js/`, then `npx playwright install --with-deps chromium webkit` and `APP=go` and `APP=ts` core e2e. Triggers: PRs touching `go/**`, `e2e/**`, `shared/**`, `src/server/**`, `src/lib/**`.
- [ ] **Step 2:** Push a branch, confirm the workflow passes. **Step 3: Commit.**

### Task 13: Deploy and stage 2 comparison report (go/no-go gate)

**Files:**
- Create: `docs/superpowers/reports/2026-11-xx-stage2-comparison.md`

- [ ] **Step 1:** Ask the user, then deploy the Go app to its Vercel project (env vars copied from the current project: `OPENAI_API_KEY`, `TRANSLATE_*`).
- [ ] **Step 2:** Verify Review Focus 5 on the real endpoint: one live translation (billed, with user's go-ahead) shows ≥ 3 `nt-main-delta` events arriving > 50 ms apart in the browser.
- [ ] **Step 3:** Run `e2e/perf/measure.ts` `--fake` locally for both apps and `--live` against both production URLs (user go-ahead), same profiles and runs as the baseline.
- [ ] **Step 4:** Write the report: tables for both apps; the **deciding metrics are page load (TTFB, FCP, LCP, first-typeable) and client JS size**; time-to-translation reported but not decisive. State plainly that the Go app at this stage lacks learning, dictionary, speech, refine/context and fold/keyboard layouts, and give a per-module JS byte estimate for stages 3–7 against the 40 KB budget, so the comparison is not flattering by omission. End with a go/no-go recommendation.
- [ ] **Step 5:** Commit the report and **stop: the user decides whether stages 3–7 proceed.**
