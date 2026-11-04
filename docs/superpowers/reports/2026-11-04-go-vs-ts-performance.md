# Go + htmx vs TypeScript: final performance comparison (Task 31)

- Date: 2026-11-04. Status: **draft, fake runs only.** Live runs, DevTools traces and the closing recommendation are placeholders (marked **PENDING**) for the controller.
- Apps: TS = TanStack Start production build (`npm run build`, Nitro Vercel preset) served by `e2e/perf/serve-ts.mjs`; Go = `go build` of `go/`. Both against the fake OpenAI server (`go/cmd/fakeopenai`, fixture `stream`), measured by the same harness, on the same machine, browsers and profiles as the stage-1 baseline ([`2026-11-02-baseline.md`](2026-11-02-baseline.md), which defines every metric).
- Commands (run one after the other, nothing else running on the machine):
  - `npx tsx e2e/perf/measure.ts --app ts --fake --runs 10 --out docs/superpowers/reports/data/2026-11-04-final-ts-fake.json` (at commit `e902c32`)
  - `npx tsx e2e/perf/measure.ts --app go --fake --runs 10 --out docs/superpowers/reports/data/2026-11-04-final-go-fake.json` (re-run at commit `1992739`, after the early-typing fix; it replaces the first Go run at `e902c32`, see "Early typing" below)
  - Tables: `npx tsx e2e/perf/table.ts docs/superpowers/reports/data/2026-11-04-final-ts-fake.json docs/superpowers/reports/data/2026-11-04-final-go-fake.json` (no `--allow-mismatch` needed: same profiles, harness hash `317267dd85bb`, Playwright 1.64.1, Chromium 156.0.8078.4, WebKit 27.2, Apple M1 Max).
- Raw data: [`data/2026-11-04-final-ts-fake.json`](data/2026-11-04-final-ts-fake.json), [`data/2026-11-04-final-go-fake.json`](data/2026-11-04-final-go-fake.json). The TS app's sources did not change between the two commits (`1992739` touches only `go/` and an e2e spec), so the TS file stays valid. Both are marked dirty only because of the untracked `.headroom/` and `.serena/` tool folders.
- All 240 runs succeeded (per app and profile: 10 load + 10 repeat load + 10 interaction + 10 probe; no `error` entries). Every settled-page translation made exactly one upstream request and showed the full fixture text; whitespace input never reached the upstream in either app.

## Harness changes since the baseline

1. `e2e/perf/table.ts` (commit `e902c32`, presentation only, identical for both apps): the typing section's headline is now **First typeable (kept and acted on)** = `max(FCP, earliest kept keystroke, earliest acted-on keystroke)` of the burst typed at first focus, shown only when that burst stayed in the field **and** was translated (n/a otherwise), with the wipe/ignore gate rows directly below it. The retype model (settle, Clear, retype) moved to its own secondary section, "Dropped-run penalty". "Input kept from" (space probe) stays as a plain row.
2. No change to `measure.ts`, `page-scripts.ts`, the proxy, the gateway or the profiles was needed for the finished Go app: the selectors (`input-textarea`, `main-translation`, `output-toolbar` Copy/Listen, `clear-input`), the app-agnostic done signal and the font blocking all work unchanged (Listen now exists in Go, so the Listen diagnostic is populated for both apps and matches done).
3. Not a harness change, but an asymmetry to know: the TS app requests `/_vercel/insights/script.js` locally (404, counted as 0 bytes); the Go app renders that tag only on Vercel (Task 29), so in `--fake` it makes no such request. Both request it in `--live`.

The harness hash differs from the baseline's (`e94a65d9c3c6`) because `e2e/tests/helpers.ts` (port scheme) and `table.ts` changed since; TS was re-measured in this session, so the TS/Go comparison never crosses harness versions.

## Headline: deciding metrics (median of 10; fake upstream, local production builds)

| Profile | Metric | TS | Go |
| --- | --- | --- | --- |
| iPhone WebKit, slow 4G | TTFB | 1152 ms | 1140 ms |
| | FCP / LCP | 2613 / 2613 ms | 2566 / 2566 ms |
| | **First typeable (kept and acted on)** | n/a: burst **wiped** 10/10 | **2579 ms** (10/10) |
| | Input kept from (space probe) | 7531 ms | 2565 ms |
| | Nav start to first main char, typing at first focus | 11221 ms (after the retype) | 5813 ms |
| | Repeat visit: first typeable (kept and acted on) | n/a: wiped 10/10 (+ remainder billed 10/10) | 721 ms in 4/10; **ignored 6/10** (see below) |
| Pixel Chromium, 4x CPU + slow 4G | TTFB | 1140 ms | 1137 ms |
| | FCP / LCP | 3188 / 3188 ms | 3180 / 3180 ms |
| | TBT | 11 ms | 0 ms |
| | **First typeable (kept and acted on)** | n/a: wiped 10/10 | **3154 ms** (10/10) |
| | Input kept from (space probe) | 8160 ms | 3148 ms |
| | Nav start to first main char, typing at first focus | 11455 ms (after the retype) | 6384 ms |
| | Repeat visit: first typeable (kept and acted on) | n/a: wiped 10/10 | 735 ms (10/10) |
| MacBook Chromium | TTFB | 3 ms | 2 ms |
| | FCP / LCP | 44 / 44 ms | 44 / 44 ms |
| | **First typeable (kept and acted on)** | n/a: wiped 10/10 (remainder billed 1/10) | **48 ms** (10/10) |
| | Input kept from (space probe) | 88 ms | 44 ms |
| | Repeat visit: first typeable (kept and acted on) | 41 ms (10/10) | 26 ms (10/10) |
| All | **Client JS, gzip -9 (external + inline)** | **285.3 KiB** (292,139 B; baseline 285.3 KiB) | **42.8 KiB** (43,863 B), −85 % |
| All | **CSS, gzip -9** | 29.2 KiB (29,875 B; baseline 28.9 KiB) | 28.2 KiB (28,839 B) |
| All | HTML, raw / gzip -9 | 16.5 KiB / 4.2 KiB | 36.7 KiB / 7.3 KiB |
| All | All transferred, cold (uncompressed locally) | 1068 KiB | 290 KiB |

### Early typing (kept and acted on)

- **TS** keeps nothing typed before React hydrates: the SSR textarea takes focus at FCP, hydration resets it, and text is kept only from 7.5 s (iPhone) / 8.2 s (Pixel) / 88 ms (MacBook). On iPhone repeat visits 10/10 (MacBook cold 1/10) the surviving tail of the wiped burst was translated as a request of its own, a billed fragment.
- **Go** keeps every keystroke from first paint (the textarea is plain server HTML; "input kept from" = FCP on every profile, and no keystroke is ever lost: probe resolution n/a). Since `1992739`, text typed before the client modules run is also translated: at init, `app.js` starts the same debounced run an `input` event would have scheduled, but only on a fresh navigation (`performance.getEntriesByType('navigation')[0].type === 'navigate'`) and only when the value differs from the server default. The cold-visit burst is now kept and acted on 10/10 on every profile, so Go's headline equals its FCP-bound first focus: 2.58 s (iPhone), 3.15 s (Pixel), 48 ms (MacBook), against TS's "never, retype needed".
- **Why the navigation-type check is needed:** browsers restore textarea values on reload and back/forward. WebKit restores this textarea on back/forward even with `autocomplete=off`. An unconditional init-time run would therefore bill a translation on every reload or back navigation with text in the field (speculative paid work). Reload and back/forward never start a run; a bfcache restore does not run the modules again. TS never sees restored text because hydration wipes the field.
- First Go run, before the fix (commit `e902c32`, same harness, superseded by the file above): the burst was kept but **ignored** 10/10 on iPhone and Pixel (cold and repeat) and 3/10 on MacBook cold; nothing was translated until the user typed again, blurred or pressed Cmd/Ctrl+Enter.

### Remaining issue: iPhone repeat visit, ignored 6/10 (for the controller)

On the iPhone repeat visit, 6/10 bursts are still ignored after the fix. All Pixel and MacBook bursts and all iPhone cold bursts are acted on. What the data and two diagnostic runs show (a temporary, uncommitted copy of `measure.ts` that logged the page state; not part of the results):

- The repeat visits fall into two groups through the same throttle proxy. In 4/10 runs FCP is ~655 ms and the burst (first key ~721 ms) is still being typed when the modules run (DOMContentLoaded ~782 ms), so its later keystrokes fire ordinary `input` events: acted on. In 6/10 runs FCP is ~1215 ms (one extra RTT, consistent with a new connection), the burst ends (~1331 ms) just before the modules run (DOMContentLoaded ~1353 ms), so the new init path starts the run: ignored in every such run. The diagnostic reproduced it in 2 of 3 runs.
- The navigation type is `navigate` in those runs and the value differs from the default, so the fix does fire: a run starts. Within ~700 ms of the last key the main text shows the stale/aborted placeholder `…` (`stream.js` `setMarks`: a live run that is no longer streaming and has no main text), Copy never enables, and **no request reaches the fake upstream**. The run is aborted before its request arrives. Cold visits use the same init path and are acted on 10/10. On cold visits the modules run ~2 s after the burst, when the page has finished loading; on these repeat visits the run starts while the page is still settling. So something that runs after module init on a fast warm load seems to abort it (a later `inputChanged`/`settingsChanged`/`htmx:abort` caller). Not investigated further: app code is out of this task's scope.
- Cost: none. The aborted run sends nothing upstream (repeat-visit upstream requests are 1 per run, the retype).
- The harness counts the `…` placeholder as "first main char" in these aborted runs. It does not change any reported row: those runs are dropped, so the counted first main char is the retype's.

Other deciding-metric notes:

- TTFB and FCP are equal within noise on the throttled profiles: both are dominated by the simulated link (2 RTT + document). Go's HTML is 2.2x larger (36.7 vs 16.5 KiB raw: server-rendered panels, `<template>`s and 6.3 KB of inline JSON data), so its document takes 197-199 ms on the link vs 84-90 ms. FCP is still equal or up to ~50 ms earlier, because the stylesheet is the only render-blocking resource in both.
- Go's DOMContentLoaded is later on the throttled profiles (4545 vs 2568 ms iPhone; 5107 vs 3180 ms Pixel): it waits for all 21 deferred/module scripts (111 KiB uncompressed here). What must arrive before DOMContentLoaded differs between the two architectures, so the row is not comparable across them. The load event, when every script has arrived, is 4.5-5.1 s in both. In production the JS is compressed (Go 43.9 KB vs TS 292 KB gzip); the live run will show the effect.
- Server cold start (local, Node client): TS 93 ms vs Go 2 ms first request; warm 4 vs 2 ms. Vercel cold starts are only visible in `--live`.

## Secondary metrics

### Translation on the settled page (fake-paced)

| Profile | Last key to first main char (TS / Go) | Last key to Copy enabled | Last key to done |
| --- | --- | --- | --- |
| iPhone WebKit | 1295 / 1253 ms | 1606 / 1473 ms | 5447 / 5376 ms |
| Pixel Chromium | 1262 / 1252 ms | 1559 / 1458 ms | 5287 / 5261 ms |
| MacBook Chromium | 708 / 689 ms | 1030 / 911 ms | 4925 / 4905 ms |

These include the 400 ms sentence-final debounce and the fake's fixed pacing (6-rune chunks every 30 ms), so they show app overhead only. Go reaches the first main char 10-40 ms earlier, Copy ~100-130 ms earlier and done 20-70 ms earlier. Neither app holds a response open after its last DOM change (request end minus last DOM change −29 to −10 ms). **With real OpenAI these timings are dominated by the model** (first main char several seconds); expect the same tens-of-milliseconds difference there, not more.

### Keyboard (simulated, mobile profiles; dy is not "lower is better")

Identical in both apps: main text dy 99 px (iPhone) / 58 px (Pixel), textarea dy 323 / 413 px, no pan needed (offsetTop 0), and main text, textarea and caret visible with focus kept 10/10 in both modes. Pixel layout-shift sum: visual mode 0.261 (TS) vs 0.246 (Go), resize mode 0.504 vs 0.498. Full rows in the tables below.

### Repeat visits (warm cache, 0 JS bytes transferred in both)

- iPhone: TTFB 1150 vs 573 ms, consistent with one extra RTT (a new connection) on the TS repeat navigation and a reused one for Go (the baseline saw the same ~1140 ms for TS). FCP 1191 vs 651 ms and LCP 1241 vs 720 ms follow from that, so read this as a connection-reuse effect, not app work. The same effect appears the other way round in the interaction runs' repeat visit: Go's repeat-visit FCP there is ~1215 ms in 6/10 runs (~655 ms in 4/10) while TS's is 622-660 ms in 10/10. That split is why Go's iPhone repeat "first focus" is 1278 ms, and it lines up exactly with the ignored bursts above. Why WebKit's connection reuse differs per app and scenario through the same proxy was not investigated. Pixel (Chromium) shows no such split.
- Pixel: TTFB 581 / 574 ms, FCP 620 / 616 ms, LCP 652 / 712 ms, CLS 0.048 / 0.051.
- MacBook: FCP 20 / 24 ms.
- Repeat-visit HTML is 17 KiB (TS) vs 37 KiB (Go) per navigation: `private, no-store` documents in both.

### Dropped-run penalty (retype model; secondary, never the headline)

| Profile | First typeable incl. retype (TS / Go) | Settle point, dropped runs (TS / Go) | Clear + retype (TS / Go) |
| --- | --- | --- | --- |
| iPhone, cold | 9180 / 2579 ms (Go: none dropped) | 9119 / n/a | 77 / n/a |
| iPhone, repeat | 3623 / 8149 ms (Go: 6/10 dropped) | 3553 / 3093 ms | 82 / 5102 ms |
| Pixel, cold | 9789 / 3154 ms (Go: none dropped) | 9690 / n/a | 96 / n/a |
| Pixel, repeat | 2533 / 735 ms (Go: none dropped) | 2446 / n/a | 91 / n/a |
| MacBook, cold | 1220 / 48 ms (Go: none dropped) | 1134 / n/a | 84 / n/a |
| MacBook, repeat | 41 / 26 ms (neither dropped) | n/a | n/a |

Go's only dropped runs are the 6 iPhone repeat visits above. Their "Clear + retype" of ~5.1 s is harness time, not app time: the aborted run's `…` placeholder satisfies the harness's "main shows text" wait at once, so the harness then waits its full 5 s for an upstream request that never comes before it clears and retypes. A user facing kept-but-untranslated text would more likely type one more key or press Cmd/Ctrl+Enter.

## Cost and behaviour: superseded upstream requests (fake runs)

Counted from `/_stats.requests` deltas recorded per scenario, against the counted translations (one per typing scenario: the burst or, when dropped, the retype; one per settled-page translation). Settled-page translations are exactly 1 by construction (the harness fails any run with more), so 0 superseded there for both apps.

| Profile | Scenario | TS upstream / counted | TS superseded | Go upstream / counted | Go superseded |
| --- | --- | --- | --- | --- | --- |
| iPhone WebKit | typing at first focus, cold | 10 / 10 | 0 | 10 / 10 | 0 |
| | typing at first focus, repeat visit | 20 / 10 | **10** (wiped burst's tail translated, then the retype) | 10 / 10 | 0 (6 aborted init-path runs sent nothing upstream) |
| | settled page | 10 / 10 | 0 | 10 / 10 | 0 |
| Pixel Chromium | cold / repeat / settled | 10 / 10 each | 0 | 10 / 10 each | 0 |
| MacBook Chromium | typing at first focus, cold | 11 / 10 | **1** | 10 / 10 | 0 |
| | repeat / settled | 10 / 10 each | 0 | 10 / 10 each | 0 |
| All | whitespace probe | 0 requests | - | 0 requests | - |
| **Total over 30 interaction runs** | | **101** for 90 counted | **11** | **90** for 90 counted | **0** |

The count is the same whether or not the server cancels: superseded means "sent upstream and then replaced". The cost differs on Vercel. When TS aborts, the cancellation reaches OpenAI (`supportsCancellation: true`) and generation stops. Go's Vercel function cannot be cancelled (stage 0 decision), so a superseded Go request runs to completion and bills its full output. In these scenarios Go produced no superseded requests: it never translates a partial burst, because the init path runs once with the full text after the debounce. So the uncancellable path was not exercised. In real typing (edits mid-stream, the e2e `late events from a superseded run are ignored` case), each superseded Go run bills a full response where TS bills a partial one.

## Code size

Plain `wc -l` (newline count) over tracked files (`git ls-files`), excluding tests (`*_test.go`, `*.test.js`, `*.test.*`, `*.browser.*`, spec files), generated files (`*_templ.go`, `icons_gen.go`, `app.css`, the syncstyles copy `base.css`, `routeTree.gen.ts`, `resultTypes.generated.ts`) and vendored htmx. The shared contract (`shared/translation/`) is used by both and counted for neither. Counted at `1992739`.

| Side | Part | Files | Lines |
| --- | --- | --- | --- |
| Go | Go (app: `main.go`, `web/*.go`, `internal/**` without `internal/fakeopenai`) | 28 | 4,110 |
| | templ | 17 | 1,169 |
| | client JS (`web/static/js`, no vendor) | 18 | 3,444 |
| | Go-only CSS (`go.css` 10, `input.css` 14; `pretendard.css` is a verbatim copy of the TS file) | 2 | 24 |
| | **Total** | 65 | **8,747** |
| | not counted above: dev/test tooling (`cmd/*`, `internal/fakeopenai`, env-gated `spike.go`) | 10 | 1,831 |
| TS | client/shared TS/TSX (`src/**` without `src/server`) | 67 | 6,233 |
| | server TS (`src/server`) | 18 | 1,527 |
| | CSS (`src/styles.css` 3,492, `src/styles/pretendard.css` 6) | 2 | 3,498 |
| | **Total** | 87 | **11,258** |

The stylesheet is shared: Go compiles the TS app's `src/styles.css` (synced to `base.css`) with its own 24 lines on top. Without CSS the comparison is Go 8,723 vs TS 7,760 lines. Go has more hand-written code for the same UI. React components and libraries gave TS several client behaviours (Floating UI, listbox/typeahead, streaming JSON, learning ranges); in Go they are either ported by hand or done server-side (JSON stream scanner, learning range preparation, SSE events, telemetry).

### Client JS per module (`cd go && make size`, Go `compress/gzip`; target 44 KB = 45,056 B, a target not a gate)

| Module | Raw | Gzip |
| --- | --- | --- |
| vendor/htmx.min.js (4.0.1) | 37,448 B | 13,330 B |
| vendor/hx-sse.min.js | 6,532 B | 2,616 B |
| learning.js | 7,815 B | 3,111 B |
| stream.js | 5,929 B | 2,446 B |
| app.js | 6,395 B | 2,381 B |
| speech.js | 4,750 B | 2,167 B |
| prefs.js | 5,443 B | 2,122 B |
| refine.js | 4,806 B | 2,060 B |
| composer.js | 4,001 B | 1,867 B |
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
| **Total** | 108,023 B | **43,794 B** (97 % of the 45,056 B target; 1,262 B headroom) |
| CSS `app.css` | 144,461 B | 29,329 B (reference: TS stylesheet compiled now, 29,524 B) |

`make size` uses Go's gzip. The harness rows above use `gzip -9` from Node's zlib on the served bodies (Go 43,863 B JS, 28,839 B CSS; TS 292,139 B JS, 29,875 B CSS). That is the method the baseline used, so the TS/Go comparison uses the harness numbers. The original budget was 40 KB. The user ruled size a target that never outranks performance, usability or parity, and it was raised to 42 KB (inspection gestures) and 44 KB (measured Adjust menu). TS client JS: 285.3 KiB gzip in two chunks (`index` 116.6 KB, `routes` 173.9 KB gzip) plus 1.6 KB inline, unchanged since the baseline. Go ships 6.7x less.

## Live production runs: **PENDING (controller, billed; production must be redeployed with `1992739` first)**

Billed request count for `--live --runs 10` (3 profiles x 10 runs = 30 interaction runs per app), from `measure.ts`'s plan (`interactions * 3` to `interactions * 7`):

- **TS (https://www.neofox.dev): 90 to 210 billed translations.**
- **Go (https://translater-go.vercel.app): 90 to 210 billed translations.**
- **Both apps: 180 to 420.**

The plan line, printed by `measure.ts --app go --live --url http://127.0.0.1:9 --runs 10` without the billed flag (nothing listens there; the plan prints and the harness refuses before any request; the count does not depend on the URL):

```
--live plan against http://127.0.0.1:9: 3 profile(s) x 10 run(s) = 30 interaction run(s). Each makes at least 3 billed OpenAI translations (typing at first focus on a cold and on a repeat visit, one on the settled page) and up to 7 when typing at first focus is lost (a partial-text translation plus the retype, on each visit): 90 to 210 billed translations. Page loads, the whitespace probe and TTFB requests are free.
```

Expectation from the fake runs, same scenarios: TS 101, Go 90 (191 total). From the code path, a single interaction run makes at most 5 in practice (per visit: one partial-tail request + the retype, plus one settled-page request), so 7 is a conservative upper bound. Nothing else in `--live` is billed. The discarded warm-up runs only in `--fake`. Page loads, the whitespace probe, the TTFB requests and the app's `/warm` call make no OpenAI request, and Listen is never pressed.

Commands:

```
npx tsx e2e/perf/measure.ts --app ts --live --url https://www.neofox.dev --runs 10 \
  --i-understand-this-is-billed --out docs/superpowers/reports/data/2026-11-04-final-ts-live.json
npx tsx e2e/perf/measure.ts --app go --live --url https://translater-go.vercel.app --runs 10 \
  --i-understand-this-is-billed --out docs/superpowers/reports/data/2026-11-04-final-go-live.json
npx tsx e2e/perf/table.ts docs/superpowers/reports/data/2026-11-04-final-ts-live.json docs/superpowers/reports/data/2026-11-04-final-go-live.json
```

Notes for the live run:

- The throttle proxy is the browser's CONNECT proxy for both apps.
- Live mode cannot count upstream requests or check the fixture text.
- "Cold" TTFB is only the first request of the session.
- Translation timings are dominated by OpenAI.
- If Web Analytics is still not enabled on translater-go (Task 30), Go's `/_vercel/insights/script.js` 404s there (counted as 0 bytes, no effect on timings).

Results: _PENDING_.

## Chrome DevTools traces: **PENDING (controller)**

Settings for both production URLs: emulate 412x915 @2.625, Slow 4G, 4x CPU, cold-cache reload, page load only. Record TTFB, FCP, LCP with breakdown (TTFB / load delay / load time / render delay), CLS, critical-path latency, scripts, and DevTools insights. Also run one trace per app of "type one sentence, main visible" (1 billed translation each, 2 total). Summaries go to `data/2026-11-04-devtools-{ts,go}.json`.

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

Caveats to weigh:

- The Go runtime is Beta on Vercel.
- Go's Vercel function cannot cancel superseded requests, so every superseded run bills its full output.
- Parity exceptions from Task 32's sign-off.
- The Safari modulepreload recovery note (Task 17 checkpoint).
- The shared TS behaviours kept in both apps by user decision (Escape clears the source outside open panels; compact synonym focus).
- The iPhone repeat-visit abort of the early-typing run described above, if it is not fixed.

## Full tables (fake runs)

Generated by `npx tsx e2e/perf/table.ts docs/superpowers/reports/data/2026-11-04-final-ts-fake.json docs/superpowers/reports/data/2026-11-04-final-go-fake.json`.

#### iphone-webkit-slow4g

iPhone 15, WebKit, Lighthouse mobile network via the throttle proxy; CPU unthrottled (WebKit cannot be CPU-throttled)

##### Page load, cold cache

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB | 1152 ms / 1161 ms | 1140 ms / 1146 ms |
| Document transfer (responseEnd - responseStart) | 84 ms / 90 ms | 197 ms / 199 ms |
| Document transfer expected on the link | 91 ms / 91 ms | 201 ms / 201 ms |
| FCP | 2613 ms / 2629 ms | 2566 ms / 2585 ms |
| LCP | 2613 ms / 2629 ms | 2566 ms / 2585 ms |
| TBT (FCP to quiet) | n/a | n/a |
| DOMContentLoaded | 2568 ms / 2581 ms | 4545 ms / 4564 ms |
| load event | 4493 ms / 4501 ms | 4546 ms / 4565 ms |
| CLS during load | n/a | n/a |
| **JS total gzip (external + inline)** | 285.3 KiB / 285.3 KiB | 42.8 KiB / 42.8 KiB |
| JS total raw (external + inline) | 907.4 KiB / 907.4 KiB | 105.5 KiB / 105.5 KiB |
| JS external raw | 903.8 KiB / 903.8 KiB | 105.5 KiB / 105.5 KiB |
| JS external transferred (incl. headers) | 904.3 KiB / 904.3 KiB | 111.3 KiB / 111.3 KiB |
| JS external gzip -9 | 283.7 KiB / 283.7 KiB | 42.8 KiB / 42.8 KiB |
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
| All transferred (incl. headers) | 1068.0 KiB / 1068.0 KiB | 289.8 KiB / 289.8 KiB |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| **First typeable (kept and acted on)** | n/a | 2579 ms / 2600 ms |
| Gate: typing at first focus wiped | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored | 0/10 yes | 0/10 yes |
| Wiped and the remainder translated (extra upstream request) | 0/10 yes | 0/10 yes |
| First focus (burst first keystroke) | 2642 ms / 2655 ms | 2579 ms / 2600 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) | 11221 ms / 11248 ms | 5813 ms / 5832 ms |
| Input kept from (max(FCP, earliest kept keystroke), space probe) | 7531 ms / 7543 ms | 2565 ms / 2593 ms |
| **First typeable (kept and acted on)** (repeat visit) | n/a | 721 ms / 735 ms (n=4) |
| Gate: typing at first focus wiped (repeat visit) | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored (repeat visit) | 0/10 yes | 6/10 yes |
| Wiped and the remainder translated (extra upstream request) (repeat visit) | 10/10 yes | 0/10 yes |
| First focus (burst first keystroke) (repeat visit) | 676 ms / 687 ms | 1278 ms / 1287 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 5049 ms / 5093 ms | 10083 ms / 10173 ms |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| First typeable incl. the retype model | 9180 ms / 9245 ms | 2579 ms / 2600 ms |
| of which harness wait (settle point - input kept from), dropped runs | 1587 ms / 1619 ms | n/a |
| Harness settle point, dropped runs | 9119 ms / 9155 ms | n/a |
| Clear + retype after settle, dropped runs | 77 ms / 90 ms | n/a |
| First typeable incl. the retype model (repeat visit) | 3623 ms / 3673 ms | 8149 ms / 8205 ms |
| Harness settle point, dropped runs (repeat visit) | 3553 ms / 3576 ms | 3093 ms / 3105 ms (n=6) |
| Clear + retype after settle, dropped runs (repeat visit) | 82 ms / 97 ms | 5102 ms / 5122 ms (n=6) |

##### Page load, repeat visit (same context, warm cache)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB (repeat) | 1150 ms / 1165 ms | 573 ms / 585 ms |
| FCP (repeat) | 1191 ms / 1206 ms | 651 ms / 656 ms |
| LCP (repeat) | 1241 ms / 1254 ms | 720 ms / 724 ms |
| TBT (FCP to quiet) (repeat) | n/a | n/a |
| DOMContentLoaded (repeat) | 1240 ms / 1257 ms | 790 ms / 792 ms |
| load event (repeat) | 1257 ms / 1266 ms | 790 ms / 793 ms |
| CLS during load (repeat) | n/a | n/a |
| JS external transferred (repeat; 0 = cache hit) | 0 B / 0 B | 0 B / 0 B |
| All transferred (repeat) | 16.9 KiB / 16.9 KiB | 37.1 KiB / 37.1 KiB |

##### Translation on the settled page

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Last key to first main char | 1295 ms / 1302 ms | 1253 ms / 1260 ms |
| Last key to Copy enabled | 1606 ms / 1621 ms | 1473 ms / 1483 ms |
| Last key to done (stream ended + Copy + DOM quiet 500 ms) | 5447 ms / 5494 ms | 5376 ms / 5418 ms |
| Request end minus last DOM change (> 0: response held open) | -29 ms / -22 ms | -24 ms / -16 ms |
| Diagnostic: last key to Listen enabled (if the app has it) | 5447 ms / 5494 ms | 5376 ms / 5418 ms |
| JS loaded through done, gzip -9 | 285.3 KiB / 285.3 KiB | 42.8 KiB / 42.8 KiB |
| JS loaded through done, raw | 907.4 KiB / 907.4 KiB | 105.5 KiB / 105.5 KiB |

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
| Earliest kept keystroke | 7531 ms / 7543 ms | 2565 ms / 2593 ms |
| Earliest keystroke shown (may be lost) | 2625 ms / 2643 ms | 2565 ms / 2593 ms |
| Probe resolution (kept - last lost) | 103 ms / 113 ms | n/a |
| Whitespace input reached upstream | 0/10 yes | 0/10 yes |

#### pixel-chromium-4xcpu-slow4g

Pixel 7, Chromium, 4x CPU (CDP) + Lighthouse mobile network via the throttle proxy

##### Page load, cold cache

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB | 1140 ms / 1141 ms | 1137 ms / 1144 ms |
| Document transfer (responseEnd - responseStart) | 90 ms / 90 ms | 199 ms / 200 ms |
| Document transfer expected on the link | 91 ms / 91 ms | 201 ms / 201 ms |
| FCP | 3188 ms / 3200 ms | 3180 ms / 3200 ms |
| LCP | 3188 ms / 3200 ms | 3180 ms / 3200 ms |
| TBT (FCP to quiet) | 11 ms / 13 ms | 0 ms / 11 ms |
| DOMContentLoaded | 3180 ms / 3192 ms | 5107 ms / 5131 ms |
| load event | 5070 ms / 5077 ms | 5108 ms / 5133 ms |
| CLS during load | 0.000 / 0.000 | 0.000 / 0.000 |
| **JS total gzip (external + inline)** | 285.3 KiB / 285.3 KiB | 42.8 KiB / 42.8 KiB |
| JS total raw (external + inline) | 907.4 KiB / 907.4 KiB | 105.5 KiB / 105.5 KiB |
| JS external raw | 903.8 KiB / 903.8 KiB | 105.5 KiB / 105.5 KiB |
| JS external transferred (incl. headers) | 904.3 KiB / 904.3 KiB | 111.3 KiB / 111.3 KiB |
| JS external gzip -9 | 283.7 KiB / 283.7 KiB | 42.8 KiB / 42.8 KiB |
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
| All transferred (incl. headers) | 1068.2 KiB / 1068.2 KiB | 289.7 KiB / 289.7 KiB |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| **First typeable (kept and acted on)** | n/a | 3154 ms / 3156 ms |
| Gate: typing at first focus wiped | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored | 0/10 yes | 0/10 yes |
| Wiped and the remainder translated (extra upstream request) | 0/10 yes | 0/10 yes |
| First focus (burst first keystroke) | 3193 ms / 3217 ms | 1406 ms / 1416 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) | 11455 ms / 11509 ms | 6384 ms / 6401 ms |
| Input kept from (max(FCP, earliest kept keystroke), space probe) | 8160 ms / 8162 ms | 3148 ms / 3172 ms |
| **First typeable (kept and acted on)** (repeat visit) | n/a | 735 ms / 739 ms |
| Gate: typing at first focus wiped (repeat visit) | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored (repeat visit) | 0/10 yes | 0/10 yes |
| Wiped and the remainder translated (extra upstream request) (repeat visit) | 0/10 yes | 0/10 yes |
| First focus (burst first keystroke) (repeat visit) | 665 ms / 674 ms | 735 ms / 739 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 4136 ms / 4201 ms | 2156 ms / 2177 ms |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| First typeable incl. the retype model | 9789 ms / 9810 ms | 3154 ms / 3156 ms |
| of which harness wait (settle point - input kept from), dropped runs | 1533 ms / 1538 ms | n/a |
| Harness settle point, dropped runs | 9690 ms / 9705 ms | n/a |
| Clear + retype after settle, dropped runs | 96 ms / 120 ms | n/a |
| First typeable incl. the retype model (repeat visit) | 2533 ms / 2550 ms | 735 ms / 739 ms |
| Harness settle point, dropped runs (repeat visit) | 2446 ms / 2460 ms | n/a |
| Clear + retype after settle, dropped runs (repeat visit) | 91 ms / 92 ms | n/a |

##### Page load, repeat visit (same context, warm cache)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB (repeat) | 581 ms / 582 ms | 574 ms / 577 ms |
| FCP (repeat) | 620 ms / 620 ms | 616 ms / 632 ms |
| LCP (repeat) | 652 ms / 664 ms | 712 ms / 728 ms |
| TBT (FCP to quiet) (repeat) | 0 ms / 0 ms | 0 ms / 0 ms |
| DOMContentLoaded (repeat) | 672 ms / 673 ms | 794 ms / 799 ms |
| load event (repeat) | 691 ms / 693 ms | 796 ms / 801 ms |
| CLS during load (repeat) | 0.048 / 0.051 | 0.051 / 0.051 |
| JS external transferred (repeat; 0 = cache hit) | 0 B / 0 B | 0 B / 0 B |
| All transferred (repeat) | 17.1 KiB / 17.1 KiB | 37.0 KiB / 37.0 KiB |

##### Translation on the settled page

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Last key to first main char | 1262 ms / 1272 ms | 1252 ms / 1261 ms |
| Last key to Copy enabled | 1559 ms / 1564 ms | 1458 ms / 1466 ms |
| Last key to done (stream ended + Copy + DOM quiet 500 ms) | 5287 ms / 5332 ms | 5261 ms / 5335 ms |
| Request end minus last DOM change (> 0: response held open) | -27 ms / -23 ms | -28 ms / -20 ms |
| Diagnostic: last key to Listen enabled (if the app has it) | 5287 ms / 5332 ms | 5261 ms / 5335 ms |
| JS loaded through done, gzip -9 | 285.3 KiB / 285.3 KiB | 42.8 KiB / 42.8 KiB |
| JS loaded through done, raw | 907.4 KiB / 907.4 KiB | 105.5 KiB / 105.5 KiB |

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
| Earliest kept keystroke | 8160 ms / 8162 ms | 1399 ms / 1421 ms |
| Earliest keystroke shown (may be lost) | 3197 ms / 3201 ms | 1399 ms / 1421 ms |
| Probe resolution (kept - last lost) | 171 ms / 186 ms | n/a |
| Whitespace input reached upstream | 0/10 yes | 0/10 yes |

#### macbook-chromium

MacBook 14" (1512x982 @2x), Chromium, unthrottled, direct connection

##### Page load, cold cache

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB | 3 ms / 3 ms | 2 ms / 2 ms |
| Document transfer (responseEnd - responseStart) | 0 ms / 0 ms | 0 ms / 0 ms |
| Document transfer expected on the link | n/a | n/a |
| FCP | 44 ms / 44 ms | 44 ms / 44 ms |
| LCP | 44 ms / 44 ms | 44 ms / 44 ms |
| TBT (FCP to quiet) | 0 ms / 0 ms | 0 ms / 0 ms |
| DOMContentLoaded | 34 ms / 36 ms | 51 ms / 53 ms |
| load event | 51 ms / 53 ms | 51 ms / 53 ms |
| CLS during load | 0.000 / 0.000 | 0.000 / 0.000 |
| **JS total gzip (external + inline)** | 285.3 KiB / 285.3 KiB | 42.8 KiB / 42.8 KiB |
| JS total raw (external + inline) | 907.4 KiB / 907.4 KiB | 105.5 KiB / 105.5 KiB |
| JS external raw | 903.8 KiB / 903.8 KiB | 105.5 KiB / 105.5 KiB |
| JS external transferred (incl. headers) | 904.3 KiB / 904.3 KiB | 111.3 KiB / 111.3 KiB |
| JS external gzip -9 | 283.7 KiB / 283.7 KiB | 42.8 KiB / 42.8 KiB |
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
| All transferred (incl. headers) | 1068.6 KiB / 1068.6 KiB | 290.0 KiB / 290.0 KiB |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| **First typeable (kept and acted on)** | n/a | 48 ms / 54 ms |
| Gate: typing at first focus wiped | 10/10 yes | 0/10 yes |
| Gate: typing at first focus ignored | 0/10 yes | 0/10 yes |
| Wiped and the remainder translated (extra upstream request) | 1/10 yes | 0/10 yes |
| First focus (burst first keystroke) | 52 ms / 53 ms | 40 ms / 54 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) | 2044 ms / 2046 ms | 808 ms / 824 ms |
| Input kept from (max(FCP, earliest kept keystroke), space probe) | 88 ms / 92 ms | 44 ms / 44 ms |
| **First typeable (kept and acted on)** (repeat visit) | 41 ms / 42 ms | 26 ms / 28 ms |
| Gate: typing at first focus wiped (repeat visit) | 0/10 yes | 0/10 yes |
| Gate: typing at first focus ignored (repeat visit) | 0/10 yes | 0/10 yes |
| Wiped and the remainder translated (extra upstream request) (repeat visit) | 0/10 yes | 0/10 yes |
| First focus (burst first keystroke) (repeat visit) | 41 ms / 42 ms | 26 ms / 27 ms |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 831 ms / 836 ms | 777 ms / 793 ms |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| First typeable incl. the retype model | 1220 ms / 1222 ms | 48 ms / 54 ms |
| of which harness wait (settle point - input kept from), dropped runs | 1046 ms / 1053 ms | n/a |
| Harness settle point, dropped runs | 1134 ms / 1138 ms | n/a |
| Clear + retype after settle, dropped runs | 84 ms / 90 ms | n/a |
| First typeable incl. the retype model (repeat visit) | 41 ms / 42 ms | 26 ms / 28 ms |
| Harness settle point, dropped runs (repeat visit) | n/a | n/a |
| Clear + retype after settle, dropped runs (repeat visit) | n/a | n/a |

##### Page load, repeat visit (same context, warm cache)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| TTFB (repeat) | 3 ms / 4 ms | 1 ms / 2 ms |
| FCP (repeat) | 20 ms / 24 ms | 24 ms / 28 ms |
| LCP (repeat) | 20 ms / 24 ms | 24 ms / 28 ms |
| TBT (FCP to quiet) (repeat) | 0 ms / 0 ms | 0 ms / 0 ms |
| DOMContentLoaded (repeat) | 10 ms / 10 ms | 20 ms / 24 ms |
| load event (repeat) | 16 ms / 17 ms | 22 ms / 25 ms |
| CLS during load (repeat) | 0.000 / 0.000 | 0.000 / 0.000 |
| JS external transferred (repeat; 0 = cache hit) | 0 B / 0 B | 0 B / 0 B |
| All transferred (repeat) | 17.4 KiB / 17.4 KiB | 37.3 KiB / 37.3 KiB |

##### Translation on the settled page

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Last key to first main char | 708 ms / 716 ms | 689 ms / 706 ms |
| Last key to Copy enabled | 1030 ms / 1039 ms | 911 ms / 916 ms |
| Last key to done (stream ended + Copy + DOM quiet 500 ms) | 4925 ms / 4937 ms | 4905 ms / 4932 ms |
| Request end minus last DOM change (> 0: response held open) | -10 ms / -5 ms | -13 ms / -9 ms |
| Diagnostic: last key to Listen enabled (if the app has it) | 4925 ms / 4937 ms | 4905 ms / 4932 ms |
| JS loaded through done, gzip -9 | 285.3 KiB / 285.3 KiB | 42.8 KiB / 42.8 KiB |
| JS loaded through done, raw | 907.4 KiB / 907.4 KiB | 105.5 KiB / 105.5 KiB |

##### Diagnostics: space probe during load

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Earliest kept keystroke | 88 ms / 92 ms | 37 ms / 39 ms |
| Earliest keystroke shown (may be lost) | 38 ms / 39 ms | 37 ms / 39 ms |
| Probe resolution (kept - last lost) | 50 ms / 53 ms | n/a |
| Whitespace input reached upstream | 0/10 yes | 0/10 yes |

#### Server TTFB (Node client, no browser)

| Metric | ts (fake) median / p90 | go (fake) median / p90 |
|---|---|---|
| Cold (first request) | 93 ms / 96 ms | 2 ms / 5 ms |
| Warm | 4 ms / 5 ms | 2 ms / 5 ms |

- ts (fake): Local process restarted per sample; cold = first GET / after TCP readiness, warm = the second GET. Node client, new connection each.
- go (fake): Local process restarted per sample; cold = first GET / after TCP readiness, warm = the second GET. Node client, new connection each.

#### Measured on

- ts (fake): 2026-11-04T04:15:23.479Z, commit e902c32961e9 (dirty), build 81ee355b8be5, harness 317267dd85bb, Apple M1 Max, 10 cores, 32 GiB, darwin 27.0.0 arm64, Playwright 1.64.1, webkit 27.2, chromium 156.0.8078.4
- go (fake): 2026-11-04T05:23:29.482Z, commit 199273919d0e (dirty), build e5a14612dceb, harness 317267dd85bb, Apple M1 Max, 10 cores, 32 GiB, darwin 27.0.0 arm64, Playwright 1.64.1, webkit 27.2, chromium 156.0.8078.4
