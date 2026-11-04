# Go + htmx vs TypeScript: final performance comparison (Task 31)

- Date: 2026-11-04. Status: **draft, fake runs only.** Live runs, DevTools traces and the closing recommendation are placeholders (marked **PENDING**) for the controller.
- Apps: TS = TanStack Start production build (`npm run build`, Nitro Vercel preset) served by `e2e/perf/serve-ts.mjs`; Go = `go build` of `go/` at the same commit. Both against the fake OpenAI server (`go/cmd/fakeopenai`, fixture `stream`), measured by the same harness, on the same machine, browsers and profiles as the stage-1 baseline ([`2026-11-02-baseline.md`](2026-11-02-baseline.md), which defines every metric).
- Commands (run one after the other, nothing else running on the machine):
  - `npx tsx e2e/perf/measure.ts --app ts --fake --runs 10 --out docs/superpowers/reports/data/2026-11-04-final-ts-fake.json`
  - `npx tsx e2e/perf/measure.ts --app go --fake --runs 10 --out docs/superpowers/reports/data/2026-11-04-final-go-fake.json`
  - Tables: `npx tsx e2e/perf/table.ts docs/superpowers/reports/data/2026-11-04-final-ts-fake.json docs/superpowers/reports/data/2026-11-04-final-go-fake.json` (no `--allow-mismatch` needed: same profiles, harness hash `317267dd85bb`, Playwright 1.64.1, Chromium 156.0.8078.4, WebKit 27.2, Apple M1 Max).
- Raw data: [`data/2026-11-04-final-ts-fake.json`](data/2026-11-04-final-ts-fake.json), [`data/2026-11-04-final-go-fake.json`](data/2026-11-04-final-go-fake.json). Both at commit `e902c32` (marked dirty only because of the untracked `.headroom/` and `.serena/` tool folders; no tracked file was modified).
- All 240 runs succeeded (per app and profile: 10 load + 10 repeat load + 10 interaction + 10 probe; no `error` entries). Every settled-page translation made exactly one upstream request and showed the full fixture text; whitespace input never reached the upstream in either app.

## Harness changes since the baseline

1. `e2e/perf/table.ts` (commit `e902c32`, presentation only, identical for both apps): the typing section's headline is now **First typeable (kept and acted on)** = `max(FCP, earliest kept keystroke, earliest acted-on keystroke)` of the burst typed at first focus, shown only when that burst stayed in the field **and** was translated (n/a otherwise), with the wipe/ignore gate rows directly below it. The retype model (settle, Clear, retype) moved to its own secondary section, "Dropped-run penalty". "Input kept from" (space probe) stays as a plain row.
2. No change to `measure.ts`, `page-scripts.ts`, the proxy, the gateway or the profiles was needed for the finished Go app: the selectors (`input-textarea`, `main-translation`, `output-toolbar` Copy/Listen, `clear-input`), the app-agnostic done signal and the font blocking all work unchanged (Listen now exists in Go, so the Listen diagnostic is populated for both apps and matches done).
3. Not a harness change, but an asymmetry to know: the TS app requests `/_vercel/insights/script.js` locally (404, counted as 0 bytes); the Go app renders that tag only on Vercel (Task 29), so in `--fake` it makes no such request. Both request it in `--live`.

The harness hash differs from the baseline's (`e94a65d9c3c6`) because `e2e/tests/helpers.ts` (port scheme) and `table.ts` changed since; TS was re-measured in this session, so the TS/Go comparison never crosses harness versions.

## Headline: deciding metrics (median of 10; fake upstream, local production builds)

| Profile | Metric | TS | Go |
| --- | --- | --- | --- |
| iPhone WebKit, slow 4G | TTFB | 1152 ms | 1148 ms |
| | FCP / LCP | 2613 / 2613 ms | 2592 / 2592 ms |
| | **First typeable (kept and acted on)** | n/a: burst **wiped** 10/10 | n/a: burst **ignored** 10/10 |
| | Input kept from (space probe) | 7531 ms | 2596 ms |
| | Repeat visit: first typeable (kept and acted on) | n/a: wiped 10/10 (+ remainder billed 10/10) | n/a: ignored 10/10 |
| Pixel Chromium, 4x CPU + slow 4G | TTFB | 1140 ms | 1141 ms |
| | FCP / LCP | 3188 / 3188 ms | 3156 / 3156 ms |
| | TBT | 11 ms | 0 ms |
| | **First typeable (kept and acted on)** | n/a: wiped 10/10 | n/a: ignored 10/10 |
| | Input kept from (space probe) | 8160 ms | 3132 ms |
| | Repeat visit: first typeable (kept and acted on) | n/a: wiped 10/10 | n/a: ignored 10/10 |
| MacBook Chromium | TTFB | 3 ms | 1 ms |
| | FCP / LCP | 44 / 44 ms | 40 / 40 ms |
| | **First typeable (kept and acted on)** | n/a: wiped 10/10 (remainder billed 1/10) | **40 ms** (7/10; ignored 3/10) |
| | Input kept from (space probe) | 88 ms | 42 ms |
| | Repeat visit: first typeable (kept and acted on) | 41 ms (10/10) | 25 ms (10/10) |
| All | **Client JS, gzip -9 (external + inline)** | **285.3 KiB** (292,139 B; baseline 285.3 KiB) | **42.7 KiB** (43,753 B), −85 % |
| All | **CSS, gzip -9** | 29.2 KiB (29,875 B; baseline 28.9 KiB) | 28.2 KiB (28,839 B) |
| All | HTML, raw / gzip -9 | 16.5 KiB / 4.2 KiB | 36.7 KiB / 7.3 KiB |
| All | All transferred, cold (uncompressed locally) | 1068 KiB | 290 KiB |

How to read the typing rows (presentation rule: kept **and** acted on, never the retype model):

- **TS** keeps nothing typed before React hydrates: the SSR textarea takes focus at FCP, hydration resets it, and text is kept only from 7.5 s (iPhone) / 8.2 s (Pixel) / 88 ms (MacBook). On iPhone repeat visits 10/10 (MacBook cold 1/10) the surviving tail of the wiped burst was translated as a request of its own, a billed fragment.
- **Go** keeps every keystroke from first paint (the textarea is plain server HTML; "input kept from" = FCP on every profile, no keystroke is ever lost: probe resolution n/a), but **text typed before the client modules have run is never translated**: `app.js` attaches its `input` listener at module execution (approx. DOMContentLoaded: 4.58 s iPhone, 5.10 s Pixel, 46 ms MacBook in these uncompressed local runs) and does not schedule a run for text already in the field at init. The user sees their text kept but no translation until they type again, blur or press Cmd/Ctrl+Enter. On the MacBook the window is ~10 ms, so 3/10 bursts landed in it.
- **Finding for the controller (not fixed here, app code is out of this task's scope):** a one-line init in `go/web/static/js/app.js` (when `ta.value.trim()` is non-empty after `initComposer`, call `composer.schedule()` or equivalent) would turn every "ignored" into "kept and acted on", making Go's headline ≈ max(FCP, module init) on every profile. TS has no equivalent behaviour to stay at parity with (it wipes the text), so this is a Go improvement, not a parity change. It does not change the harness's billed count (one request per visit either way). **Caveat: an unconditional init-schedule is unsafe.** Browsers restore textarea values on reload and back/forward navigation (form restoration, independent of bfcache); TS never sees this because hydration wipes the field, and the Go app already anticipates a non-empty field at init (`inputRevision = ta.value.trim() ? 1 : 0`). Scheduling a run for any text present at init would bill a translation on every reload of a page with text in it, which the "no speculative paid work" constraint forbids. The fix must tell "the user typed before the modules ran" (an `input` event happened) from "the browser restored the value" (none did), e.g. with a tiny early listener that records pre-module `input` events; the page has no inline JS today, so that is a small design decision, not a one-liner. Sequencing if fixed: fix, re-run the Go fake (~25 min, same harness hash; the TS file stays valid), re-commit the Go JSON and these tables, then the live run. Otherwise the live run measures the current behaviour.

Other deciding-metric notes:

- TTFB and FCP are equal within noise on the throttled profiles: both are dominated by the simulated link (2 RTT + document). Go's HTML is 2.2x larger (36.7 vs 16.5 KiB raw: server-rendered panels, `<template>`s and 6.3 KB of inline JSON data), so its document takes 193-199 ms on the link vs 84-90 ms, yet FCP is still 20-30 ms earlier because the only render-blocking resource is the stylesheet in both.
- Go's DOMContentLoaded is later on the throttled profiles (4582 vs 2568 ms iPhone; 5104 vs 3180 ms Pixel): it waits for all 21 deferred/module scripts (111 KiB uncompressed here). What must arrive before DOMContentLoaded differs between the two architectures, so the row is not comparable across them; the load event, when every script has arrived, is 4.5-5.1 s in both. In production the JS is compressed (Go 43.7 KB vs TS 292 KB gzip); the live run will show the effect.
- Server cold start (local, Node client): TS 93 ms vs Go 1 ms first request; warm 4 vs 1 ms. Vercel cold starts are only visible in `--live`.

## Secondary metrics

### Translation on the settled page (fake-paced)

| Profile | Last key to first main char (TS / Go) | Last key to Copy enabled | Last key to done |
| --- | --- | --- | --- |
| iPhone WebKit | 1295 / 1281 ms | 1606 / 1506 ms | 5447 / 5529 ms |
| Pixel Chromium | 1262 / 1251 ms | 1559 / 1462 ms | 5287 / 5306 ms |
| MacBook Chromium | 708 / 694 ms | 1030 / 907 ms | 4925 / 4887 ms |

These include the 400 ms sentence-final debounce and the fake's fixed pacing (6-rune chunks every 30 ms), so they show app overhead only: Go reaches first main char 10-15 ms earlier and Copy ~100-120 ms earlier. Done is the fixture's stream length in both (Go +20-80 ms on the throttled profiles, −40 ms on MacBook). Neither app holds a response open after its last DOM change (request end minus last DOM change −36 to −10 ms). **With real OpenAI these timings are dominated by the model** (first main char several seconds); expect the same tens-of-milliseconds difference there, not more.

### Keyboard (simulated, mobile profiles; dy is not "lower is better")

Identical in both apps: main text dy 99 px (iPhone) / 58 px (Pixel), textarea dy 323 / 413 px, no pan needed (offsetTop 0), and main text, textarea and caret visible with focus kept 10/10 in both modes. Pixel layout-shift sum: visual mode 0.261 (TS) vs 0.246 (Go), resize mode 0.504 vs 0.498. Full rows in the tables below.

### Repeat visits (warm cache, 0 JS bytes transferred in both)

- iPhone: TTFB 1150 vs 583 ms, consistent with one extra RTT (a new connection) on the TS repeat navigation and a reused one for Go (the baseline saw the same ~1140 ms for TS); FCP 1191 vs 655 ms and LCP 1241 vs 716 ms follow from that, so read this as a connection-reuse effect, not app work. The same effect appears the other way round in the interaction runs' repeat visit: Go's repeat-visit FCP there is ~1220 ms in 8/10 runs (655-666 ms in 2/10) while TS's is 622-660 ms in 10/10, and Go's textarea takes focus ~65 ms after that FCP in every run. That is why Go's iPhone repeat "first focus" is 1287 ms and its repeat "nav start to first main char" and dropped-run penalty are higher; the cause of WebKit's connection reuse differing per app and scenario (through the same throttle proxy) was not investigated. Pixel (Chromium) shows no such split.
- Pixel: TTFB 581 / 575 ms, FCP 620 / 612 ms, LCP 652 / 712 ms, CLS 0.048 / 0.051.
- MacBook: FCP 20 / 20 ms.
- Repeat-visit HTML is 17 KiB (TS) vs 37 KiB (Go) per navigation: `private, no-store` documents in both.

### Dropped-run penalty (retype model; secondary, never the headline)

| Profile | First typeable incl. retype (TS / Go) | of which harness wait to settle (TS / Go) | Clear + retype (TS / Go) |
| --- | --- | --- | --- |
| iPhone, cold | 9180 / 8665 ms | 1587 / 2972 ms | 77 / 3087 ms |
| iPhone, repeat | 3623 / 5458 ms | - | 82 / 3099 ms |
| Pixel, cold | 9789 / 9165 ms | 1533 / 2929 ms | 96 / 3102 ms |
| Pixel, repeat | 2533 / 4903 ms | - | 91 / 3078 ms |
| MacBook, cold (dropped runs only for Go: 3/10) | 1220 / 50 ms (p90 4123) | 1046 / 998 ms | 84 / 3079 ms |

**This model penalises "ignored" more than "wiped" by construction**: a wiped burst is judged at the settle point, while an ignored (kept) burst first gets the harness's 3 s act-on grace (`ACT_WAIT_MS` in `--fake`, 10 s in `--live`) before Clear + retype, so Go's "Clear + retype" ≈ 3.0 s of grace + ~80 ms of typing, and its repeat-visit numbers look worse than TS's for that reason alone. Go's harness settle point is also earlier (5.6 vs 9.1 s iPhone) because there is less to download. A user facing kept-but-untranslated text would more likely type one more key or press Cmd/Ctrl+Enter than Clear and retype; the init fix above removes the case.

## Cost and behaviour: superseded upstream requests (fake runs)

Counted from `/_stats.requests` deltas recorded per scenario, against the counted translations (one per typing scenario: the burst or, when dropped, the retype; one per settled-page translation). Settled-page translations are exactly 1 by construction (the harness fails any run with more), so 0 superseded there for both apps.

| Profile | Scenario | TS upstream / counted | TS superseded | Go upstream / counted | Go superseded |
| --- | --- | --- | --- | --- | --- |
| iPhone WebKit | typing at first focus, cold | 10 / 10 | 0 | 10 / 10 | 0 |
| | typing at first focus, repeat visit | 20 / 10 | **10** (wiped burst's tail translated, then the retype) | 10 / 10 | 0 |
| | settled page | 10 / 10 | 0 | 10 / 10 | 0 |
| Pixel Chromium | cold / repeat / settled | 10 / 10 each | 0 | 10 / 10 each | 0 |
| MacBook Chromium | typing at first focus, cold | 11 / 10 | **1** | 10 / 10 | 0 |
| | repeat / settled | 10 / 10 each | 0 | 10 / 10 each | 0 |
| All | whitespace probe | 0 requests | - | 0 requests | - |
| **Total over 30 interaction runs** | | **101** for 90 counted | **11** | **90** for 90 counted | **0** |

The count is the same whether or not the server cancels: superseded means "sent upstream and then replaced". The cost differs on Vercel: when TS aborts, the cancellation reaches OpenAI (`supportsCancellation: true`) and generation stops; Go's Vercel function cannot be cancelled (stage 0 decision), so a superseded Go request runs to completion and bills its full output. In these scenarios Go produced no superseded requests (it never translates a partial burst: pre-JS text is kept but not sent), so the uncancellable path was not exercised. In real typing (edits mid-stream, the e2e `late events from a superseded run are ignored` case) each superseded Go run bills a full response where TS bills a partial one.

## Code size

Plain `wc -l` (newline count) over tracked files (`git ls-files`), excluding tests (`*_test.go`, `*.test.js`, `*.test.*`, `*.browser.*`, spec files), generated files (`*_templ.go`, `icons_gen.go`, `app.css`, the syncstyles copy `base.css`, `routeTree.gen.ts`, `resultTypes.generated.ts`) and vendored htmx. The shared contract (`shared/translation/`) is used by both and counted for neither.

| Side | Part | Files | Lines |
| --- | --- | --- | --- |
| Go | Go (app: `main.go`, `web/*.go`, `internal/**` without `internal/fakeopenai`) | 28 | 4,110 |
| | templ | 17 | 1,169 |
| | client JS (`web/static/js`, no vendor) | 18 | 3,428 |
| | Go-only CSS (`go.css` 10, `input.css` 14; `pretendard.css` is a verbatim copy of the TS file) | 2 | 24 |
| | **Total** | 65 | **8,731** |
| | not counted above: dev/test tooling (`cmd/*`, `internal/fakeopenai`, env-gated `spike.go`) | 10 | 1,831 |
| TS | client/shared TS/TSX (`src/**` without `src/server`) | 67 | 6,233 |
| | server TS (`src/server`) | 18 | 1,527 |
| | CSS (`src/styles.css` 3,492, `src/styles/pretendard.css` 6) | 2 | 3,498 |
| | **Total** | 87 | **11,258** |

The stylesheet is shared: Go compiles the TS app's `src/styles.css` (synced to `base.css`) with its own 24 lines on top, so without CSS the comparison is Go 8,707 vs TS 7,760 lines. Go has more hand-written code for the same UI because the client behaviours React components and libraries provided (Floating UI, listbox/typeahead, streaming JSON, learning ranges) are ported by hand or done server-side (JSON stream scanner, learning range preparation, SSE events, telemetry).

### Client JS per module (`cd go && make size`, Go `compress/gzip`; target 44 KB = 45,056 B, a target not a gate)

| Module | Raw | Gzip |
| --- | --- | --- |
| vendor/htmx.min.js (4.0.1) | 37,448 B | 13,330 B |
| vendor/hx-sse.min.js | 6,532 B | 2,616 B |
| learning.js | 7,815 B | 3,111 B |
| stream.js | 5,929 B | 2,446 B |
| app.js | 6,237 B | 2,308 B |
| speech.js | 4,750 B | 2,167 B |
| prefs.js | 5,443 B | 2,122 B |
| refine.js | 4,806 B | 2,060 B |
| composer.js | 3,908 B | 1,831 B |
| float.js | 3,756 B | 1,759 B |
| adjust.js | 3,750 B | 1,752 B |
| layout.js | 3,777 B | 1,658 B |
| listbox.js | 3,101 B | 1,340 B |
| inspect.js | 2,851 B | 1,301 B |
| dictionary.js | 2,105 B | 1,063 B |
| pcm.js | 1,725 B | 794 B |
| copy.js | 1,527 B | 738 B |
| context.js | 986 B | 557 B |
| settings.js | 876 B | 482 B |
| transition.js | 449 B | 250 B |
| **Total** | 107,772 B | **43,685 B** (97 % of the 45,056 B target; 1,371 B headroom) |
| CSS `app.css` | 144,461 B | 29,329 B (reference: TS stylesheet compiled now, 29,524 B) |

`make size` uses Go's gzip; the harness rows above use `gzip -9` from Node's zlib on the served bodies (Go 43,753 B JS, 28,839 B CSS; TS 292,139 B JS, 29,875 B CSS), which is the method the baseline used, so the TS/Go comparison uses the harness numbers. The original budget was 40 KB; the user ruled size a target that never outranks performance, usability or parity, and it was raised to 42 KB (inspection gestures) and 44 KB (measured Adjust menu). TS client JS: 285.3 KiB gzip in two chunks (`index` 116.6 KB, `routes` 173.9 KB gzip) plus 1.6 KB inline, unchanged since the baseline; Go ships 6.7x less.

## Live production runs: **PENDING (controller, billed)**

Billed request count for `--live --runs 10` (3 profiles x 10 runs = 30 interaction runs per app), from `measure.ts`'s plan (`interactions * 3` to `interactions * 7`; the plan line is printed before anything runs):

- **TS (https://www.neofox.dev): 90 to 210 billed translations.**
- **Go (https://translater-go.vercel.app): 90 to 210 billed translations.**
- **Both apps: 180 to 420.**

The plan line, printed by `measure.ts --app go --live --url http://127.0.0.1:9 --runs 10` without the billed flag (nothing listens there; the plan prints and the harness refuses before any request; the count does not depend on the URL):

```
--live plan against http://127.0.0.1:9: 3 profile(s) x 10 run(s) = 30 interaction run(s). Each makes at least 3 billed OpenAI translations (typing at first focus on a cold and on a repeat visit, one on the settled page) and up to 7 when typing at first focus is lost (a partial-text translation plus the retype, on each visit): 90 to 210 billed translations. Page loads, the whitespace probe and TTFB requests are free.
```

Expectation from the fake runs, same scenarios: TS 101, Go 90 (191 total). From the code path, a single interaction run makes at most 5 in practice (per visit: one partial-tail request + the retype, plus one settled-page request), so 7 is a conservative upper bound. Nothing else in `--live` is billed: the discarded warm-up runs only in `--fake`, page loads, the whitespace probe, the TTFB requests and the app's `/warm` call make no OpenAI request, and Listen is never pressed.

Commands:

```
npx tsx e2e/perf/measure.ts --app ts --live --url https://www.neofox.dev --runs 10 \
  --i-understand-this-is-billed --out docs/superpowers/reports/data/2026-11-04-final-ts-live.json
npx tsx e2e/perf/measure.ts --app go --live --url https://translater-go.vercel.app --runs 10 \
  --i-understand-this-is-billed --out docs/superpowers/reports/data/2026-11-04-final-go-live.json
npx tsx e2e/perf/table.ts docs/superpowers/reports/data/2026-11-04-final-ts-live.json docs/superpowers/reports/data/2026-11-04-final-go-live.json
```

Notes for the live run: the throttle proxy is the browser's CONNECT proxy for both; live mode cannot count upstream requests or check the fixture text; "cold" TTFB is only the first request of the session; translation timings are dominated by OpenAI. If Web Analytics is still not enabled on translater-go (Task 30), Go's `/_vercel/insights/script.js` 404s there (counted as 0 bytes, no effect on timings). Decide the Go "ignored" init fix (above) before this run.

Results: _PENDING_.

## Chrome DevTools traces: **PENDING (controller)**

Settings for both production URLs: emulate 412x915 @2.625, Slow 4G, 4x CPU, cold-cache reload, page load only. Record TTFB, FCP, LCP with breakdown (TTFB / load delay / load time / render delay), CLS, critical-path latency, scripts, and DevTools insights; plus one trace per app of "type one sentence, main visible" (1 billed translation each, 2 total). Summaries go to `data/2026-11-04-devtools-{ts,go}.json`.

| Metric (lab) | TS (www.neofox.dev) | Go (translater-go.vercel.app) |
| --- | --- | --- |
| TTFB | _PENDING_ (baseline 337 ms) | _PENDING_ |
| FCP | _PENDING_ | _PENDING_ |
| LCP (TTFB / load delay / load time / render delay) | _PENDING_ (baseline 1,729 ms, render delay 1,392 ms) | _PENDING_ |
| CLS | _PENDING_ | _PENDING_ |
| Max critical-path latency | _PENDING_ | _PENDING_ |
| Scripts | _PENDING_ | _PENDING_ |
| Insights | _PENDING_ | _PENDING_ |
| Type one sentence, main visible | _PENDING_ | _PENDING_ |

## Recommendation: **PENDING (controller, after live runs, DevTools traces and Task 32)**

Caveats to weigh: the Go runtime is Beta on Vercel; Go's Vercel function cannot cancel superseded requests (full output billed per superseded run); parity exceptions from Task 32's sign-off; the Safari modulepreload recovery note (Task 17 checkpoint); the shared TS behaviours kept in both apps by user decision (Escape clears the source outside open panels, compact synonym focus); and the "ignored pre-JS typing" finding above if it is not fixed.

## Full tables (fake runs)

Generated by `npx tsx e2e/perf/table.ts docs/superpowers/reports/data/2026-11-04-final-ts-fake.json docs/superpowers/reports/data/2026-11-04-final-go-fake.json`.

#### iphone-webkit-slow4g

iPhone 15, WebKit, Lighthouse mobile network via the throttle proxy; CPU unthrottled (WebKit cannot be CPU-throttled)

##### Page load, cold cache

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB | 1152 ms / 1161 ms | 1148 ms / 1154 ms |
| Document transfer (responseEnd - responseStart) | 84 ms / 90 ms | 193 ms / 195 ms |
| Document transfer expected on the link | 91 ms / 91 ms | 201 ms / 201 ms |
| FCP | 2613 ms / 2629 ms | 2592 ms / 2611 ms |
| LCP | 2613 ms / 2629 ms | 2592 ms / 2611 ms |
| TBT (FCP to quiet) | n/a | n/a |
| DOMContentLoaded | 2568 ms / 2581 ms | 4582 ms / 4597 ms |
| load event | 4493 ms / 4501 ms | 4582 ms / 4598 ms |
| CLS during load | n/a | n/a |
| **JS total gzip (external + inline)** | 285.3 KiB / 285.3 KiB | 42.7 KiB / 42.7 KiB |
| JS total raw (external + inline) | 907.4 KiB / 907.4 KiB | 105.2 KiB / 105.2 KiB |
| JS external raw | 903.8 KiB / 903.8 KiB | 105.2 KiB / 105.2 KiB |
| JS external transferred (incl. headers) | 904.3 KiB / 904.3 KiB | 111.1 KiB / 111.1 KiB |
| JS external gzip -9 | 283.7 KiB / 283.7 KiB | 42.7 KiB / 42.7 KiB |
| JS inline raw | 3687 B / 3687 B | 0 B / 0 B |
| JS inline gzip -9 | 1645 B / 1647 B | 0 B / 0 B |
| Inline data scripts raw (JSON) | 0 B / 0 B | 6317 B / 6317 B |
| CSS external raw | 146.5 KiB / 146.5 KiB | 141.1 KiB / 141.1 KiB |
| CSS external transferred (incl. headers) | 146.8 KiB / 146.8 KiB | 141.4 KiB / 141.4 KiB |
| CSS external gzip -9 | 29.2 KiB / 29.2 KiB | 28.2 KiB / 28.2 KiB |
| CSS inline raw | 0 B / 0 B | 0 B / 0 B |
| CSS inline gzip -9 | 0 B / 0 B | 0 B / 0 B |
| HTML raw | 16.5 KiB / 16.5 KiB | 36.7 KiB / 36.7 KiB |
| HTML transferred (incl. headers) | 16.9 KiB / 16.9 KiB | 37.1 KiB / 37.1 KiB |
| All transferred (incl. headers) | 1068.0 KiB / 1068.0 KiB | 289.6 KiB / 289.6 KiB |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| **First typeable (kept and acted on)** | n/a | n/a |
| Gate: typing at first focus wiped | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored | 0/10 yes | 10/10 yes |
| Wiped and the remainder translated (extra upstream request) | 0/10 yes | 0/10 yes |
| First focus (burst first keystroke) | 2642 ms / 2655 ms | 2595 ms / 2618 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) | 11221 ms / 11248 ms | 10622 ms / 10676 ms |
| Input kept from (max(FCP, earliest kept keystroke), space probe) | 7531 ms / 7543 ms | 2596 ms / 2606 ms |
| **First typeable (kept and acted on)** (repeat visit) | n/a | n/a |
| Gate: typing at first focus wiped (repeat visit) | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored (repeat visit) | 0/10 yes | 10/10 yes |
| Wiped and the remainder translated (extra upstream request) (repeat visit) | 10/10 yes | 0/10 yes |
| First focus (burst first keystroke) (repeat visit) | 676 ms / 687 ms | 1287 ms / 1293 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 5049 ms / 5093 ms | 6862 ms / 7416 ms |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| First typeable incl. the retype model | 9180 ms / 9245 ms | 8665 ms / 8711 ms |
| of which harness wait (settle point - input kept from), dropped runs | 1587 ms / 1619 ms | 2972 ms / 3001 ms |
| Harness settle point, dropped runs | 9119 ms / 9155 ms | 5578 ms / 5595 ms |
| Clear + retype after settle, dropped runs | 77 ms / 90 ms | 3087 ms / 3116 ms |
| First typeable incl. the retype model (repeat visit) | 3623 ms / 3673 ms | 5458 ms / 5485 ms |
| Harness settle point, dropped runs (repeat visit) | 3553 ms / 3576 ms | 2361 ms / 2365 ms |
| Clear + retype after settle, dropped runs (repeat visit) | 82 ms / 97 ms | 3099 ms / 3122 ms |

##### Page load, repeat visit (same context, warm cache)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB (repeat) | 1150 ms / 1165 ms | 583 ms / 585 ms |
| FCP (repeat) | 1191 ms / 1206 ms | 655 ms / 657 ms |
| LCP (repeat) | 1241 ms / 1254 ms | 716 ms / 726 ms |
| TBT (FCP to quiet) (repeat) | n/a | n/a |
| DOMContentLoaded (repeat) | 1240 ms / 1257 ms | 797 ms / 800 ms |
| load event (repeat) | 1257 ms / 1266 ms | 797 ms / 801 ms |
| CLS during load (repeat) | n/a | n/a |
| JS external transferred (repeat; 0 = cache hit) | 0 B / 0 B | 0 B / 0 B |
| All transferred (repeat) | 16.9 KiB / 16.9 KiB | 37.1 KiB / 37.1 KiB |

##### Translation on the settled page

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Last key to first main char | 1295 ms / 1302 ms | 1281 ms / 1290 ms |
| Last key to Copy enabled | 1606 ms / 1621 ms | 1506 ms / 1520 ms |
| Last key to done (stream ended + Copy + DOM quiet 500 ms) | 5447 ms / 5494 ms | 5529 ms / 5550 ms |
| Request end minus last DOM change (> 0: response held open) | -29 ms / -22 ms | -36 ms / -19 ms |
| Diagnostic: last key to Listen enabled (if the app has it) | 5447 ms / 5494 ms | 5529 ms / 5550 ms |
| JS loaded through done, gzip -9 | 285.3 KiB / 285.3 KiB | 42.7 KiB / 42.7 KiB |
| JS loaded through done, raw | 907.4 KiB / 907.4 KiB | 105.2 KiB / 105.2 KiB |

##### Keyboard open (simulated; dy is not "lower is better", read it with visibility)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| visualViewport shrink + pan: final visual viewport offsetTop (scroll-to-caret model) | 0 px / 0 px | 0 px / 0 px |
| visualViewport shrink + pan: layout-shift sum | n/a | n/a |
| visualViewport shrink + pan: main text dy | 99 px / 99 px | 99 px / 99 px |
| visualViewport shrink + pan: source textarea dy | 323 px / 323 px | 323 px / 323 px |
| visualViewport shrink + pan: main text visible | 10/10 yes | 10/10 yes |
| visualViewport shrink + pan: textarea visible | 10/10 yes | 10/10 yes |
| visualViewport shrink + pan: caret visible | 10/10 yes | 10/10 yes |
| visualViewport shrink + pan: textarea keeps focus | 10/10 yes | 10/10 yes |
| Layout viewport resize: final visual viewport offsetTop (scroll-to-caret model) | n/a | n/a |
| Layout viewport resize: layout-shift sum | n/a | n/a |
| Layout viewport resize: main text dy | 99 px / 99 px | 99 px / 99 px |
| Layout viewport resize: source textarea dy | 323 px / 323 px | 323 px / 323 px |
| Layout viewport resize: main text visible | 10/10 yes | 10/10 yes |
| Layout viewport resize: textarea visible | 10/10 yes | 10/10 yes |
| Layout viewport resize: caret visible | 10/10 yes | 10/10 yes |
| Layout viewport resize: textarea keeps focus | 10/10 yes | 10/10 yes |

##### Diagnostics: space probe during load

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Earliest kept keystroke | 7531 ms / 7543 ms | 2596 ms / 2606 ms |
| Earliest keystroke shown (may be lost) | 2625 ms / 2643 ms | 2596 ms / 2606 ms |
| Probe resolution (kept - last lost) | 103 ms / 113 ms | n/a |
| Whitespace input reached upstream | 0/10 yes | 0/10 yes |

#### pixel-chromium-4xcpu-slow4g

Pixel 7, Chromium, 4x CPU (CDP) + Lighthouse mobile network via the throttle proxy

##### Page load, cold cache

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB | 1140 ms / 1141 ms | 1141 ms / 1142 ms |
| Document transfer (responseEnd - responseStart) | 90 ms / 90 ms | 199 ms / 200 ms |
| Document transfer expected on the link | 91 ms / 91 ms | 201 ms / 201 ms |
| FCP | 3188 ms / 3200 ms | 3156 ms / 3172 ms |
| LCP | 3188 ms / 3200 ms | 3156 ms / 3172 ms |
| TBT (FCP to quiet) | 11 ms / 13 ms | 0 ms / 0 ms |
| DOMContentLoaded | 3180 ms / 3192 ms | 5104 ms / 5109 ms |
| load event | 5070 ms / 5077 ms | 5106 ms / 5110 ms |
| CLS during load | 0.000 / 0.000 | 0.000 / 0.000 |
| **JS total gzip (external + inline)** | 285.3 KiB / 285.3 KiB | 42.7 KiB / 42.7 KiB |
| JS total raw (external + inline) | 907.4 KiB / 907.4 KiB | 105.2 KiB / 105.2 KiB |
| JS external raw | 903.8 KiB / 903.8 KiB | 105.2 KiB / 105.2 KiB |
| JS external transferred (incl. headers) | 904.3 KiB / 904.3 KiB | 111.1 KiB / 111.1 KiB |
| JS external gzip -9 | 283.7 KiB / 283.7 KiB | 42.7 KiB / 42.7 KiB |
| JS inline raw | 3687 B / 3687 B | 0 B / 0 B |
| JS inline gzip -9 | 1645 B / 1645 B | 0 B / 0 B |
| Inline data scripts raw (JSON) | 0 B / 0 B | 6317 B / 6317 B |
| CSS external raw | 146.5 KiB / 146.5 KiB | 141.1 KiB / 141.1 KiB |
| CSS external transferred (incl. headers) | 146.8 KiB / 146.8 KiB | 141.4 KiB / 141.4 KiB |
| CSS external gzip -9 | 29.2 KiB / 29.2 KiB | 28.2 KiB / 28.2 KiB |
| CSS inline raw | 0 B / 0 B | 0 B / 0 B |
| CSS inline gzip -9 | 0 B / 0 B | 0 B / 0 B |
| HTML raw | 16.5 KiB / 16.5 KiB | 36.7 KiB / 36.7 KiB |
| HTML transferred (incl. headers) | 16.8 KiB / 16.8 KiB | 37.0 KiB / 37.0 KiB |
| All transferred (incl. headers) | 1068.2 KiB / 1068.2 KiB | 289.5 KiB / 289.5 KiB |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| **First typeable (kept and acted on)** | n/a | n/a |
| Gate: typing at first focus wiped | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored | 0/10 yes | 10/10 yes |
| Wiped and the remainder translated (extra upstream request) | 0/10 yes | 0/10 yes |
| First focus (burst first keystroke) | 3193 ms / 3217 ms | 1389 ms / 1400 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) | 11455 ms / 11509 ms | 10667 ms / 10680 ms |
| Input kept from (max(FCP, earliest kept keystroke), space probe) | 8160 ms / 8162 ms | 3132 ms / 3136 ms |
| **First typeable (kept and acted on)** (repeat visit) | n/a | n/a |
| Gate: typing at first focus wiped (repeat visit) | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored (repeat visit) | 0/10 yes | 10/10 yes |
| Wiped and the remainder translated (extra upstream request) (repeat visit) | 0/10 yes | 0/10 yes |
| First focus (burst first keystroke) (repeat visit) | 665 ms / 674 ms | 731 ms / 735 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 4136 ms / 4201 ms | 6362 ms / 6388 ms |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| First typeable incl. the retype model | 9789 ms / 9810 ms | 9165 ms / 9172 ms |
| of which harness wait (settle point - input kept from), dropped runs | 1533 ms / 1538 ms | 2929 ms / 2938 ms |
| Harness settle point, dropped runs | 9690 ms / 9705 ms | 6065 ms / 6067 ms |
| Clear + retype after settle, dropped runs | 96 ms / 120 ms | 3102 ms / 3105 ms |
| First typeable incl. the retype model (repeat visit) | 2533 ms / 2550 ms | 4903 ms / 4910 ms |
| Harness settle point, dropped runs (repeat visit) | 2446 ms / 2460 ms | 1824 ms / 1829 ms |
| Clear + retype after settle, dropped runs (repeat visit) | 91 ms / 92 ms | 3078 ms / 3080 ms |

##### Page load, repeat visit (same context, warm cache)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB (repeat) | 581 ms / 582 ms | 575 ms / 581 ms |
| FCP (repeat) | 620 ms / 620 ms | 612 ms / 628 ms |
| LCP (repeat) | 652 ms / 664 ms | 712 ms / 712 ms |
| TBT (FCP to quiet) (repeat) | 0 ms / 0 ms | 0 ms / 0 ms |
| DOMContentLoaded (repeat) | 672 ms / 673 ms | 791 ms / 792 ms |
| load event (repeat) | 691 ms / 693 ms | 792 ms / 793 ms |
| CLS during load (repeat) | 0.048 / 0.051 | 0.051 / 0.051 |
| JS external transferred (repeat; 0 = cache hit) | 0 B / 0 B | 0 B / 0 B |
| All transferred (repeat) | 17.1 KiB / 17.1 KiB | 37.0 KiB / 37.0 KiB |

##### Translation on the settled page

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Last key to first main char | 1262 ms / 1272 ms | 1251 ms / 1256 ms |
| Last key to Copy enabled | 1559 ms / 1564 ms | 1462 ms / 1467 ms |
| Last key to done (stream ended + Copy + DOM quiet 500 ms) | 5287 ms / 5332 ms | 5306 ms / 5327 ms |
| Request end minus last DOM change (> 0: response held open) | -27 ms / -23 ms | -21 ms / -14 ms |
| Diagnostic: last key to Listen enabled (if the app has it) | 5287 ms / 5332 ms | 5306 ms / 5327 ms |
| JS loaded through done, gzip -9 | 285.3 KiB / 285.3 KiB | 42.7 KiB / 42.7 KiB |
| JS loaded through done, raw | 907.4 KiB / 907.4 KiB | 105.2 KiB / 105.2 KiB |

##### Keyboard open (simulated; dy is not "lower is better", read it with visibility)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| visualViewport shrink + pan: final visual viewport offsetTop (scroll-to-caret model) | 0 px / 0 px | 0 px / 0 px |
| visualViewport shrink + pan: layout-shift sum | 0.261 / 0.265 | 0.246 / 0.246 |
| visualViewport shrink + pan: main text dy | 58 px / 58 px | 58 px / 58 px |
| visualViewport shrink + pan: source textarea dy | 413 px / 413 px | 413 px / 413 px |
| visualViewport shrink + pan: main text visible | 10/10 yes | 10/10 yes |
| visualViewport shrink + pan: textarea visible | 10/10 yes | 10/10 yes |
| visualViewport shrink + pan: caret visible | 10/10 yes | 10/10 yes |
| visualViewport shrink + pan: textarea keeps focus | 10/10 yes | 10/10 yes |
| Layout viewport resize: final visual viewport offsetTop (scroll-to-caret model) | n/a | n/a |
| Layout viewport resize: layout-shift sum | 0.504 / 0.504 | 0.498 / 0.498 |
| Layout viewport resize: main text dy | 58 px / 58 px | 58 px / 58 px |
| Layout viewport resize: source textarea dy | 413 px / 413 px | 413 px / 413 px |
| Layout viewport resize: main text visible | 10/10 yes | 10/10 yes |
| Layout viewport resize: textarea visible | 10/10 yes | 10/10 yes |
| Layout viewport resize: caret visible | 10/10 yes | 10/10 yes |
| Layout viewport resize: textarea keeps focus | 10/10 yes | 10/10 yes |

##### Diagnostics: space probe during load

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Earliest kept keystroke | 8160 ms / 8162 ms | 1387 ms / 1392 ms |
| Earliest keystroke shown (may be lost) | 3197 ms / 3201 ms | 1387 ms / 1392 ms |
| Probe resolution (kept - last lost) | 171 ms / 186 ms | n/a |
| Whitespace input reached upstream | 0/10 yes | 0/10 yes |

#### macbook-chromium

MacBook 14" (1512x982 @2x), Chromium, unthrottled, direct connection

##### Page load, cold cache

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB | 3 ms / 3 ms | 1 ms / 2 ms |
| Document transfer (responseEnd - responseStart) | 0 ms / 0 ms | 0 ms / 1 ms |
| Document transfer expected on the link | n/a | n/a |
| FCP | 44 ms / 44 ms | 40 ms / 44 ms |
| LCP | 44 ms / 44 ms | 40 ms / 44 ms |
| TBT (FCP to quiet) | 0 ms / 0 ms | 0 ms / 0 ms |
| DOMContentLoaded | 34 ms / 36 ms | 46 ms / 50 ms |
| load event | 51 ms / 53 ms | 46 ms / 50 ms |
| CLS during load | 0.000 / 0.000 | 0.000 / 0.000 |
| **JS total gzip (external + inline)** | 285.3 KiB / 285.3 KiB | 42.7 KiB / 42.7 KiB |
| JS total raw (external + inline) | 907.4 KiB / 907.4 KiB | 105.2 KiB / 105.2 KiB |
| JS external raw | 903.8 KiB / 903.8 KiB | 105.2 KiB / 105.2 KiB |
| JS external transferred (incl. headers) | 904.3 KiB / 904.3 KiB | 111.1 KiB / 111.1 KiB |
| JS external gzip -9 | 283.7 KiB / 283.7 KiB | 42.7 KiB / 42.7 KiB |
| JS inline raw | 3687 B / 3687 B | 0 B / 0 B |
| JS inline gzip -9 | 1645 B / 1647 B | 0 B / 0 B |
| Inline data scripts raw (JSON) | 0 B / 0 B | 6317 B / 6317 B |
| CSS external raw | 146.5 KiB / 146.5 KiB | 141.1 KiB / 141.1 KiB |
| CSS external transferred (incl. headers) | 146.8 KiB / 146.8 KiB | 141.4 KiB / 141.4 KiB |
| CSS external gzip -9 | 29.2 KiB / 29.2 KiB | 28.2 KiB / 28.2 KiB |
| CSS inline raw | 0 B / 0 B | 0 B / 0 B |
| CSS inline gzip -9 | 0 B / 0 B | 0 B / 0 B |
| HTML raw | 16.5 KiB / 16.5 KiB | 36.7 KiB / 36.7 KiB |
| HTML transferred (incl. headers) | 16.8 KiB / 16.8 KiB | 37.0 KiB / 37.0 KiB |
| All transferred (incl. headers) | 1068.6 KiB / 1068.6 KiB | 289.8 KiB / 289.8 KiB |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| **First typeable (kept and acted on)** | n/a | 40 ms / 52 ms (n=7) |
| Gate: typing at first focus wiped | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored | 0/10 yes | 3/10 yes |
| Wiped and the remainder translated (extra upstream request) | 1/10 yes | 0/10 yes |
| First focus (burst first keystroke) | 52 ms / 53 ms | 35 ms / 51 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) | 2044 ms / 2046 ms | 807 ms / 4906 ms |
| Input kept from (max(FCP, earliest kept keystroke), space probe) | 88 ms / 92 ms | 42 ms / 44 ms |
| **First typeable (kept and acted on)** (repeat visit) | 41 ms / 42 ms | 25 ms / 28 ms |
| Gate: typing at first focus wiped (repeat visit) | 0/10 yes | 0/10 yes |
| Gate: typing at first focus ignored (repeat visit) | 0/10 yes | 0/10 yes |
| Wiped and the remainder translated (extra upstream request) (repeat visit) | 0/10 yes | 0/10 yes |
| First focus (burst first keystroke) (repeat visit) | 41 ms / 42 ms | 25 ms / 28 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 831 ms / 836 ms | 776 ms / 792 ms |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| First typeable incl. the retype model | 1220 ms / 1222 ms | 50 ms / 4123 ms |
| of which harness wait (settle point - input kept from), dropped runs | 1046 ms / 1053 ms | 998 ms / 1004 ms (n=3) |
| Harness settle point, dropped runs | 1134 ms / 1138 ms | 1042 ms / 1044 ms (n=3) |
| Clear + retype after settle, dropped runs | 84 ms / 90 ms | 3079 ms / 3113 ms (n=3) |
| First typeable incl. the retype model (repeat visit) | 41 ms / 42 ms | 25 ms / 28 ms |
| Harness settle point, dropped runs (repeat visit) | n/a | n/a |
| Clear + retype after settle, dropped runs (repeat visit) | n/a | n/a |

##### Page load, repeat visit (same context, warm cache)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB (repeat) | 3 ms / 4 ms | 1 ms / 1 ms |
| FCP (repeat) | 20 ms / 24 ms | 20 ms / 20 ms |
| LCP (repeat) | 20 ms / 24 ms | 20 ms / 20 ms |
| TBT (FCP to quiet) (repeat) | 0 ms / 0 ms | 0 ms / 0 ms |
| DOMContentLoaded (repeat) | 10 ms / 10 ms | 20 ms / 20 ms |
| load event (repeat) | 16 ms / 17 ms | 20 ms / 21 ms |
| CLS during load (repeat) | 0.000 / 0.000 | 0.000 / 0.000 |
| JS external transferred (repeat; 0 = cache hit) | 0 B / 0 B | 0 B / 0 B |
| All transferred (repeat) | 17.4 KiB / 17.4 KiB | 37.3 KiB / 37.3 KiB |

##### Translation on the settled page

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Last key to first main char | 708 ms / 716 ms | 694 ms / 702 ms |
| Last key to Copy enabled | 1030 ms / 1039 ms | 907 ms / 920 ms |
| Last key to done (stream ended + Copy + DOM quiet 500 ms) | 4925 ms / 4937 ms | 4887 ms / 4938 ms |
| Request end minus last DOM change (> 0: response held open) | -10 ms / -5 ms | -18 ms / -10 ms |
| Diagnostic: last key to Listen enabled (if the app has it) | 4925 ms / 4937 ms | 4887 ms / 4938 ms |
| JS loaded through done, gzip -9 | 285.3 KiB / 285.3 KiB | 42.7 KiB / 42.7 KiB |
| JS loaded through done, raw | 907.4 KiB / 907.4 KiB | 105.2 KiB / 105.2 KiB |

##### Diagnostics: space probe during load

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Earliest kept keystroke | 88 ms / 92 ms | 36 ms / 37 ms |
| Earliest keystroke shown (may be lost) | 38 ms / 39 ms | 36 ms / 37 ms |
| Probe resolution (kept - last lost) | 50 ms / 53 ms | n/a |
| Whitespace input reached upstream | 0/10 yes | 0/10 yes |

#### Server TTFB (Node client, no browser)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Cold (first request) | 93 ms / 96 ms | 1 ms / 1 ms |
| Warm | 4 ms / 5 ms | 1 ms / 1 ms |

- ts (fake): Local process restarted per sample; cold = first GET / after TCP readiness, warm = the second GET. Node client, new connection each.
- go (fake): Local process restarted per sample; cold = first GET / after TCP readiness, warm = the second GET. Node client, new connection each.

#### Measured on

- ts (fake): 2026-11-04T04:15:23.479Z, commit e902c32961e9 (dirty), build 81ee355b8be5, harness 317267dd85bb, Apple M1 Max, 10 cores, 32 GiB, darwin 27.0.0 arm64, Playwright 1.64.1, webkit 27.2, chromium 156.0.8078.4
- go (fake): 2026-11-04T04:38:59.493Z, commit e902c32961e9 (dirty), build 0a7c89f7715e, harness 317267dd85bb, Apple M1 Max, 10 cores, 32 GiB, darwin 27.0.0 arm64, Playwright 1.64.1, webkit 27.2, chromium 156.0.8078.4
