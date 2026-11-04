# Go + htmx vs TypeScript: final performance comparison (Task 31)

- Date: 2026-11-04. Status: **draft with fake and live runs.** The DevTools traces and the closing recommendation are placeholders (marked **PENDING**) for the controller.
- Apps: TS = TanStack Start (`npm run build`, Nitro Vercel preset); Go = `go build` of `go/`. Same harness, same machine (Apple M1 Max, Playwright 1.64.1, Chromium 156.0.8078.4, WebKit 27.2), same profiles as the stage-1 baseline ([`2026-11-02-baseline.md`](2026-11-02-baseline.md), which defines every metric).
- **Fake runs** (local production builds against the fake OpenAI server, fixture `stream`), one app after the other with nothing else running:
  - `npx tsx e2e/perf/measure.ts --app ts --fake --runs 10 --out docs/superpowers/reports/data/2026-11-04-final-ts-fake.json`
  - `npx tsx e2e/perf/measure.ts --app go --fake --runs 10 --out docs/superpowers/reports/data/2026-11-04-final-go-fake.json`
- **Live runs** (billed; production deployments; throttle proxy as the browser's CONNECT proxy on the throttled profiles):
  - `npx tsx e2e/perf/measure.ts --app ts --live --url https://www.neofox.dev --runs 10 --i-understand-this-is-billed --out docs/superpowers/reports/data/2026-11-04-final-ts-live.json`
  - `npx tsx e2e/perf/measure.ts --app go --live --url https://translater-go.vercel.app --runs 10 --i-understand-this-is-billed --out docs/superpowers/reports/data/2026-11-04-final-go-live.json`
- Tables: `npx tsx e2e/perf/table.ts <ts.json> <go.json>` for each pair; no `--allow-mismatch` needed (same profiles, harness `dd731a369455`, browsers, Playwright, machine).
- Commits: **TS fake and TS live at `0968bde`; Go fake and Go live at `56fd91b`**, which adds only the Go schema-order fix (see "Bug found by the live run") on top of `0968bde`; the harness is identical. The Go app includes the early-typing fix `1992739` and the schema-order fix `56fd91b`, and production (translater-go, deployment `translater-lrrl514y6`) ran both during the Go live run. The files are marked dirty only because of the untracked `.headroom/` and `.serena/` tool folders.
- Every run succeeded: 120/120 per file (per profile: 10 load + 10 repeat load + 10 interaction + 10 probe). In the fake runs every settled-page translation made exactly one upstream request with the full fixture text, and whitespace input never reached the upstream.

Raw data: [`ts-fake`](data/2026-11-04-final-ts-fake.json), [`go-fake`](data/2026-11-04-final-go-fake.json), [`ts-live`](data/2026-11-04-final-ts-live.json), [`go-live`](data/2026-11-04-final-go-live.json).

## Harness changes since the baseline

All apply to both apps identically. The harness hash (sha256 of `e2e/perf` sources and `e2e/tests/helpers.ts`) is now `dd731a369455` (baseline `e94a65d9c3c6`). Both apps were re-measured with it, in fake and live mode, so no comparison crosses harness versions. The earlier drafts of this report used `317267dd85bb`; their files are replaced.

1. **Presentation** (`e902c32`, `table.ts`). The typing headline is **First typeable (kept and acted on)** = `max(FCP, earliest kept keystroke, earliest acted-on keystroke)` of the burst typed at first focus. It is shown only when that burst stayed in the field **and** was translated, and is n/a otherwise; the wipe/ignore gate rows sit directly below it. The retype model (settle, Clear, retype) moved to its own secondary section, "Dropped-run penalty".
2. **Gateway keep-alive** (`a71aed5`, `gateway.ts` + test). The `--fake` gateway closed idle browser connections after Node's 5 s keep-alive (closing at ~6 s). The throttle proxy relays that close ~RTT/2 late, so WebKit reused the dying connection for the next request and lost it; Chromium retries such a request, WebKit does not. This caused the Go "iPhone repeat visit ignored 6/10" in the previous draft (an early-typed `POST /translate` sent on the dying connection failed with "network connection was lost"; diagnosed by the controller). It also explains the earlier "WebKit connection reuse / extra RTT" asymmetry on repeat navigations: TS's iPhone repeat-visit TTFB is now 581 ms instead of 1150 ms. The keep-alive now lives in `createGateway` (10 min, `headersTimeout` above it), longer than any measurement phase, as production's would be. A unit test asserts it.
3. **Translation request count** (`be4c0c9`, `requests.ts` + test, `measure.ts`, `table.ts`). The page's own translation requests are counted per scenario from the browser side. A translation request is a same-origin POST whose body carries the text: the TS server-function JSON with a `"text"` key, or the Go `/translate` form with `text=`. The free warm-ups (TS server function, Go `/warm`) have empty bodies. In `--fake` the count equals the fake's `/_stats` count for every scenario of both apps. In `--live` it is the **billed count**, which the harness previously could not record. New rows: "Translation requests sent by the page".
4. **Live-mode fixes** (`0968bde`, `measure.ts`):
   - The deployed TS app (built from `master`) has no `data-testid` on its Copy button; the branch's TS has one. The harness waited for a Copy that never matched and failed every live TS interaction. Copy is now selected by its class (`[data-testid="output-toolbar"] .copy-button`), which both apps render.
   - The space probe left a `networkidle` timeout as an unhandled rejection, which killed the whole first live TS attempt. It is now recorded as a failed probe run.
5. No change was needed for the Go app's features: the selectors, the app-agnostic done signal and the font blocking work unchanged. Listen now exists in Go, so the Listen diagnostic is populated for both apps and matches done.

Known asymmetry, not a harness change: locally (`--fake`) only TS requests `/_vercel/insights/script.js` (404, 0 bytes); Go renders that tag only on Vercel. Live, both load it (Go 200 now), and TS also loads Cloudflare's `beacon.min.js` (10.3 KB gzip), which counts in its live JS total.

## Headline: deciding metrics (median of 10)

Fake = local production builds, fonts blocked, uncompressed transfer (gzip sizes computed). Live = production deployments, real compression and fonts, OpenAI.

| Profile                          | Metric                                     | TS fake                   | Go fake                 | TS live                                                                | Go live                                       |
| -------------------------------- | ------------------------------------------ | ------------------------- | ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| iPhone WebKit, slow 4G           | TTFB                                       | 1141 ms                   | 1140 ms                 | 2725 ms (p90 3857)                                                     | **1774 ms** (p90 1776)                        |
|                                  | FCP = LCP                                  | 2583 ms                   | 2552 ms                 | 6119 ms (p90 9555)                                                     | **2909 ms** (p90 2959)                        |
|                                  | **First typeable (kept and acted on)**     | n/a: wiped 10/10          | **2564 ms** (10/10)     | n/a: wiped 10/10                                                       | **2938 ms** (10/10)                           |
|                                  | Repeat visit: first typeable               | n/a: wiped 10/10          | 725 ms (10/10)          | 1845 ms in 2/10; wiped 8/10                                            | 879 ms (10/10)                                |
| Pixel Chromium, 4x CPU + slow 4G | TTFB                                       | 1139 ms                   | 1138 ms                 | 2752 ms (p90 6634)                                                     | **1772 ms** (p90 1778)                        |
|                                  | FCP = LCP                                  | 3198 ms                   | 3160 ms                 | 4930 ms (p90 15252)                                                    | **2912 ms** (p90 3008)                        |
|                                  | TBT                                        | 21 ms                     | 0 ms                    | 25 ms                                                                  | 0 ms                                          |
|                                  | **First typeable (kept and acted on)**     | n/a: wiped 10/10          | **3142 ms** (10/10)     | n/a: wiped 10/10                                                       | **2898 ms** (10/10)                           |
|                                  | Repeat visit: first typeable               | n/a: wiped 10/10          | 735 ms (10/10)          | n/a: wiped 10/10                                                       | 913 ms (10/10)                                |
| MacBook Chromium (no throttling) | TTFB                                       | 3 ms                      | 2 ms                    | 1266 ms (p90 2424)                                                     | **36 ms** (p90 50)                            |
|                                  | FCP = LCP                                  | 44 ms                     | 40 ms                   | 3006 ms (p90 4836)                                                     | **312 ms** (p90 332)                          |
|                                  | **First typeable (kept and acted on)**     | n/a: wiped 10/10          | **44 ms** (10/10)       | n/a: wiped 10/10                                                       | **306 ms** (10/10)                            |
|                                  | Repeat visit: first typeable               | 43 ms (10/10)             | 24 ms (10/10)           | 2204 ms in 4/10; wiped 6/10                                            | 247 ms (10/10)                                |
| All                              | **Client JS, gzip -9 (external + inline)** | **285.3 KiB** (292,138 B) | **42.8 KiB** (43,863 B) | 303.9 KiB (incl. Cloudflare beacon 10.0 KiB + Vercel insights 2.0 KiB) | 44.8 KiB (incl. Vercel insights 2.0 KiB)      |
| All                              | JS transferred, live (compressed)          |                           |                         | 312.3 KiB (br; beacon gzip)                                            | **54.0 KiB** (br; 3 small files uncompressed) |
| All                              | **CSS, gzip -9**                           | 29.2 KiB (29,875 B)       | 28.2 KiB (28,839 B)     | 28.3 KiB                                                               | 28.2 KiB                                      |
| All                              | All transferred, cold                      | 1068 KiB (uncompressed)   | 290 KiB (uncompressed)  | 505 KiB                                                                | **249 KiB**                                   |

### Gate rows beside the headline (typing at first focus)

| Profile | Visit  | TS fake: wiped / ignored / remainder billed | Go fake   | TS live        | Go live   |
| ------- | ------ | ------------------------------------------- | --------- | -------------- | --------- |
| iPhone  | cold   | 10 / 0 / 0 of 10                            | 0 / 0 / 0 | 10 / 0 / **5** | 0 / 0 / 0 |
|         | repeat | 10 / 0 / **10**                             | 0 / 0 / 0 | 8 / 0 / **8**  | 0 / 0 / 0 |
| Pixel   | cold   | 10 / 0 / 0                                  | 0 / 0 / 0 | 10 / 0 / 0     | 0 / 0 / 0 |
|         | repeat | 10 / 0 / **1**                              | 0 / 0 / 0 | 10 / 0 / 0     | 0 / 0 / 0 |
| MacBook | cold   | 10 / 0 / **1**                              | 0 / 0 / 0 | 10 / 0 / 0     | 0 / 0 / 0 |
|         | repeat | 0 / 0 / 0                                   | 0 / 0 / 0 | 6 / 0 / **1**  | 0 / 0 / 0 |

"Remainder billed" = the burst was wiped and its surviving tail was translated as a request of its own (an extra billed request) before the retype.

### Early typing

- **TS** keeps nothing typed before React hydrates. The SSR textarea takes focus at first paint, but hydration resets it. Text is kept from 7.5 s (iPhone) / 8.2 s (Pixel) / 90 ms (MacBook) in the fake runs, and from 7.3 / 8.4 / 5.0 s live. Every cold burst on every profile was wiped, fake and live. A wiped burst's tail is often translated as a fragment (14 extra billed requests in the live run).
- **Go** keeps every keystroke from first paint: the textarea is plain server HTML, "input kept from" = FCP on every profile, and no keystroke is ever lost (probe resolution n/a). Since `1992739` it also translates them. At init, `app.js` starts the same debounced run an `input` event would have scheduled, but only on a fresh navigation (`performance.getEntriesByType('navigation')[0].type === 'navigate'`) and only when the value differs from the server default. Every burst, cold and repeat, fake and live, on every profile, was kept and acted on (60/60 typing scenarios live and 60/60 fake).
- **Why the navigation-type check matters:** browsers restore textarea values on reload and back/forward. WebKit restores this textarea on back/forward even with `autocomplete=off`. Starting a run for any text present at init would bill a translation on every reload or back navigation with text in the field. Only the `navigate` entry type prevents that; reload and back/forward never start a run, and a bfcache restore does not run the modules again. TS never sees restored text because hydration wipes the field.
- The previous draft's "Go iPhone repeat visit ignored 6/10" was the gateway keep-alive artifact (harness change 2), not app behaviour. With the fix, 10/10 are acted on in both modes.

### Other deciding-metric notes

- **Fake:** TTFB and FCP are equal within noise on the throttled profiles; both are dominated by the simulated link (2 RTT + document). Go's HTML is 2.2x larger (36.7 vs 16.5 KiB raw: server-rendered panels, `<template>`s, 6.3 KB of inline JSON), yet its FCP is equal or ~40 ms earlier, because the stylesheet is the only render-blocking resource in both.
- **Live:** Go is ahead on TTFB, FCP/LCP, first typeable and the load event on every profile. FCP is 2.91 vs 6.12 s on iPhone and 2.91 vs 4.93 s on Pixel, with a much tighter p90 (3.0 vs 9.6 s; 3.0 vs 15.3 s). On the MacBook it is 0.31 vs 3.0 s.
- **Where the live difference comes from:**
  - The TS site sits behind Cloudflare (`server: cloudflare`, then Vercel), so it pays an extra TLS hop. Curl from this machine: TS TLS 0.5-1.5 s and TTFB 1.0-2.1 s; Go TLS 0.02 s and TTFB 0.23-0.25 s. Node-client server TTFB: TS warm 1155 ms, Go 246 ms.
  - TS transfers 312 KiB of compressed JS against Go's 54 KiB over the shared slow-4G link.
  - Part of the TTFB gap is that hosting difference, not the app architecture. A like-for-like comparison would need both behind the same edge.
  - The FCP and first-typeable gap on the throttled profiles (2-3 s) is larger than the TTFB gap (~1 s): the remainder is TS's render path (its FCP waits for more on the link).
- **Go's DOMContentLoaded** is later in the fake runs (4530 vs 2543 ms iPhone; 5106 vs 3192 ms Pixel): it waits for all 21 deferred/module scripts, uncompressed locally. Live, with brotli, it is earlier on iPhone (3617 vs 6122 ms) and later on Pixel (5988 vs 5242 ms; 4x CPU). The load event is earlier for Go live on every profile.
- **Server start (fake, local):** cold 97 vs 1 ms, warm 5 vs 0 ms. Live "cold" (the first request of the session): TS 1360 ms, Go 455 ms.
- **Function regions (left as deployed):** the TS function runs in `icn1` (Seoul) and the Go function in `iad1` (Washington, D.C.), with the edge in `icn1` for both. From this machine (Korea) each Go `/translate` crosses the Pacific to the function; OpenAI's own location is unknown. The live translation timings below are measured with these regions.

## Secondary metrics

### Translation on the settled page

| Profile | Mode | Last key to first main char (TS / Go)    | Last key to Copy enabled | Last key to done                          | Request end minus last DOM change |
| ------- | ---- | ---------------------------------------- | ------------------------ | ----------------------------------------- | --------------------------------- |
| iPhone  | fake | 1258 / 1267 ms                           | 1569 / 1495 ms           | 5368 / 5526 ms                            | −24 / −20 ms                      |
|         | live | 4345 (p90 9258) / **2263** (p90 2500) ms | 4424 / **2359** ms       | 7071 (p90 12631) / **4882** (p90 5069) ms | −17 / +167 ms                     |
| Pixel   | fake | 1264 / 1255 ms                           | 1559 / 1466 ms           | 5265 / 5328 ms                            | −34 / −23 ms                      |
|         | live | 3620 (p90 4949) / **2115** (p90 2188) ms | 4031 / **2251** ms       | 6416 (p90 10965) / **4873** (p90 5230) ms | −32 / +158 ms                     |
| MacBook | fake | 686 / 695 ms                             | 989 / 914 ms             | 4790 / 4924 ms                            | −19 / −13 ms                      |
|         | live | 3018 (p90 4363) / **1659** (p90 2029) ms | 3208 / **1786** ms       | 6216 (p90 8833) / **4415** (p90 4885) ms  | −16 / +175 ms                     |

- Fake (400 ms debounce + app overhead + fixed fake pacing): equal within ±10 ms to the first main char; Copy ~75-95 ms earlier for Go; done 60-160 ms later for Go.
- Live (OpenAI-dominated, model, reasoning and tier identical): Go is ahead on every row and profile. First main char comes 1.4-2.1 s earlier (medians), Copy 1.4-2.1 s earlier and done 1.3-2.2 s earlier, with much tighter p90s. The TS live numbers include its Cloudflare hop and wider variance (TS p90 first main char 4.4-9.3 s against Go's 2.0-2.5 s).
- "Request end minus last DOM change" is +158 to +175 ms for Go live (negative in the fake runs and for TS live): the Go response stays open ~170 ms after the last visible change. That is after done's last DOM change, so it does not delay anything the user sees; noted, not investigated.

**Bug found by the live run and fixed in `56fd91b`:**

- **Symptom:** the first Go live run (at `0968bde`, production before the fix) showed main arriving in one block. Copy enabled 0-184 ms after the first main char, which came 0.9-1.6 s later than TS's.
- **Cause (diagnosed by the controller):** `BuildRequest` decoded the shared result schema into a `map[string]any`, so the schema went to OpenAI with alphabetically sorted keys. The model then wrote `main` after `alternatives`, with the language fields last.
- **Fix:** `56fd91b` sends the schema's original bytes and adds a byte-order test. Vercel streaming itself was verified with the stage-0 `NT_SPIKE` probe on a preview (300 ms event spacing preserved).
- **Old numbers:** they are invalid for first main char and Copy. For the record, Go before the fix, iPhone / Pixel / MacBook, was 5249 / 4922 / 4637 ms to first main char, 5310 / 4951 / 4740 ms to Copy and 5955 / 5623 / 5392 ms to done.
- **Why the fake runs never showed it:** the fake server streams its fixture in a fixed order regardless of the schema.

### Keyboard (simulated, mobile profiles, fake; dy is not "lower is better")

Identical in both apps: main text dy 99 px (iPhone) / 58 px (Pixel), textarea dy 323 / 413 px, no pan needed (offsetTop 0). Main text, textarea and caret stay visible with focus kept, 10/10 in both modes. Pixel layout-shift sum: visual mode 0.258 (TS) vs 0.246 (Go), resize mode 0.504 vs 0.498. The live files repeat these rows with the same values.

### Repeat visits (warm cache)

- **Fake:** iPhone TTFB 581 / 578 ms, FCP 615 / 655 ms, LCP 660 / 715 ms. Pixel FCP 620 / 616 ms, LCP 664 / 712 ms. MacBook FCP 20 / 20 ms. Go's LCP is ~50 ms later on the throttled profiles; its 37 KiB uncached HTML (vs 17 KiB) takes longer on the link.
- **Live:**
  - iPhone FCP 1232 vs 855 ms, Pixel 1246 vs 884 ms, MacBook 606 vs 242 ms.
  - TS revalidates a script (340-354 B transferred) where Go's hashed assets are cache hits (0 B).
  - HTML per navigation: 5.0 KiB (TS) vs 8.1 KiB (Go) compressed. Both serve `private, no-store` documents.

### Dropped-run penalty (retype model; secondary, never the headline)

Go has no dropped runs in either mode, so this applies to TS only.

| Profile | TS fake: first typeable incl. retype (cold / repeat) | TS live (cold / repeat) |
| ------- | ---------------------------------------------------- | ----------------------- |
| iPhone  | 9113 / 3012 ms                                       | 14244 / 10634 ms        |
| Pixel   | 9795 / 2568 ms                                       | 11679 / 4176 ms         |
| MacBook | 1193 / 43 ms                                         | 7254 / 3960 ms          |

TS fake's harness wait (settle point minus "input kept from") is 1.0-1.6 s of those numbers, and Clear + retype is 57-95 ms.

## Cost and behaviour: superseded and billed translation requests

Counted per scenario. Fake: the fake upstream's `/_stats.requests`, which matches the page's own count exactly in every scenario. Live: the page's own count (harness change 3). Counted translations = 1 per typing scenario (the burst or, if dropped, the retype) + 1 per settled-page translation; anything above that is a superseded request (sent and then replaced).

| Profile                        | Scenario                      | TS fake sent (superseded) | Go fake      | TS live                 | Go live             |
| ------------------------------ | ----------------------------- | ------------------------- | ------------ | ----------------------- | ------------------- |
| iPhone                         | typing at first focus, cold   | 10 (0)                    | 10 (0)       | 15 (**5**)              | 10 (0)              |
|                                | typing at first focus, repeat | 20 (**10**)               | 10 (0)       | 18 (**8**)              | 10 (0)              |
|                                | settled page                  | 10 (0)                    | 10 (0)       | 10 (0)                  | 10 (0)              |
| Pixel                          | cold / repeat / settled       | 10 / 11 (**1**) / 10      | 10 / 10 / 10 | 10 / 10 / 10            | 10 / 10 / 10        |
| MacBook                        | cold / repeat / settled       | 11 (**1**) / 10 / 10      | 10 / 10 / 10 | 10 / 11 (**1**) / 10    | 10 / 10 / 10        |
| All                            | whitespace probe              | 0                         | 0            | not measurable live     | not measurable live |
| **Total, 30 interaction runs** |                               | **102** (12 superseded)   | **90** (0)   | **104** (14 superseded) | **90** (0)          |

- **Billed count of the live runs (actual):**
  - TS **104**, Go **90**, against the harness's printed plan of 90-210 per app. The plan line was printed before each run: "3 profile(s) x 10 run(s) = 30 interaction run(s) … 90 to 210 billed translations".
  - The Go live run was repeated after `56fd91b` (90 billed again; the first Go live run, also 90, is replaced).
  - **Also billed this session (TS only):**
    - A first live TS attempt that failed on the Copy selector. Every interaction failed, and the probe crash ended the run after 28 of 30 attempted interactions. Each attempted interaction sent at least the cold-visit translation(s) before failing, so roughly 28-35 requests; this was not recorded.
    - One diagnostic translation.
    - A 1-run validation (3).
  - **Total billed this session ≈ 104 (TS) + 90 + 90 (Go, two runs) + ~32-39 ≈ 316-323 translations.**
- **Superseded requests:**
  - Every superseded request in both modes is TS's wiped-burst fragment; Go produced none, because it never translates a partial burst.
  - The count is the same whether or not the server cancels. The cost differs on Vercel: a superseded TS request is aborted at OpenAI (`supportsCancellation: true`), while Go's Vercel function cannot be cancelled (stage 0 decision), so a superseded Go run bills its full output.
  - In real typing (edits mid-stream, the e2e `late events from a superseded run are ignored` case) Go would pay more per superseded run. In these scenarios TS paid for 14 fragments and Go for none.

## Code size

Plain `wc -l` (newline count) over tracked files (`git ls-files`), excluding tests (`*_test.go`, `*.test.js`, `*.test.*`, `*.browser.*`, spec files), generated files (`*_templ.go`, `icons_gen.go`, `app.css`, the syncstyles copy `base.css`, `routeTree.gen.ts`, `resultTypes.generated.ts`) and vendored htmx. The shared contract (`shared/translation/`) is used by both and counted for neither. Counted at `1992739`.

| Side | Part                                                                                          | Files | Lines      |
| ---- | --------------------------------------------------------------------------------------------- | ----- | ---------- |
| Go   | Go (app: `main.go`, `web/*.go`, `internal/**` without `internal/fakeopenai`)                  | 28    | 4,110      |
|      | templ                                                                                         | 17    | 1,169      |
|      | client JS (`web/static/js`, no vendor)                                                        | 18    | 3,444      |
|      | Go-only CSS (`go.css` 10, `input.css` 14; `pretendard.css` is a verbatim copy of the TS file) | 2     | 24         |
|      | **Total**                                                                                     | 65    | **8,747**  |
|      | not counted above: dev/test tooling (`cmd/*`, `internal/fakeopenai`, env-gated `spike.go`)    | 10    | 1,831      |
| TS   | client/shared TS/TSX (`src/**` without `src/server`)                                          | 67    | 6,233      |
|      | server TS (`src/server`)                                                                      | 18    | 1,527      |
|      | CSS (`src/styles.css` 3,492, `src/styles/pretendard.css` 6)                                   | 2     | 3,498      |
|      | **Total**                                                                                     | 87    | **11,258** |

The stylesheet is shared: Go compiles the TS app's `src/styles.css` (synced to `base.css`) with its own 24 lines on top. Without CSS the comparison is Go 8,723 vs TS 7,760 lines. Go has more hand-written code for the same UI. React components and libraries gave TS several client behaviours (Floating UI, listbox/typeahead, streaming JSON, learning ranges); in Go they are either ported by hand or done server-side (JSON stream scanner, learning range preparation, SSE events, telemetry).

### Client JS per module (`cd go && make size`, Go `compress/gzip`; target 44 KB = 45,056 B, a target not a gate)

| Module                     | Raw       | Gzip                                                         |
| -------------------------- | --------- | ------------------------------------------------------------ |
| vendor/htmx.min.js (4.0.1) | 37,448 B  | 13,330 B                                                     |
| vendor/hx-sse.min.js       | 6,532 B   | 2,616 B                                                      |
| learning.js                | 7,815 B   | 3,111 B                                                      |
| stream.js                  | 5,929 B   | 2,446 B                                                      |
| app.js                     | 6,395 B   | 2,381 B                                                      |
| speech.js                  | 4,750 B   | 2,167 B                                                      |
| prefs.js                   | 5,443 B   | 2,122 B                                                      |
| refine.js                  | 4,806 B   | 2,060 B                                                      |
| composer.js                | 4,001 B   | 1,867 B                                                      |
| float.js                   | 3,756 B   | 1,759 B                                                      |
| adjust.js                  | 3,750 B   | 1,752 B                                                      |
| layout.js                  | 3,777 B   | 1,658 B                                                      |
| listbox.js                 | 3,101 B   | 1,340 B                                                      |
| inspect.js                 | 2,851 B   | 1,301 B                                                      |
| dictionary.js              | 2,105 B   | 1,063 B                                                      |
| pcm.js                     | 1,725 B   | 794 B                                                        |
| copy.js                    | 1,527 B   | 738 B                                                        |
| context.js                 | 986 B     | 557 B                                                        |
| settings.js                | 876 B     | 482 B                                                        |
| transition.js              | 449 B     | 250 B                                                        |
| **Total**                  | 108,023 B | **43,794 B** (97 % of the 45,056 B target; 1,262 B headroom) |
| CSS `app.css`              | 144,461 B | 29,329 B (reference: TS stylesheet compiled now, 29,524 B)   |

`make size` uses Go's gzip. The harness rows above use `gzip -9` from Node's zlib on the served bodies (Go 43,863 B JS, 28,839 B CSS; TS 292,139 B JS, 29,875 B CSS). That is the method the baseline used, so the TS/Go comparison uses the harness numbers. The original budget was 40 KB. The user ruled size a target that never outranks performance, usability or parity, and it was raised to 42 KB (inspection gestures) and 44 KB (measured Adjust menu). TS client JS: 285.3 KiB gzip locally in two chunks plus 1.6 KB inline, unchanged since the baseline; the deployed TS (`master`) is 303.9 KiB including third-party beacons. Go ships 6.7x less.

## Chrome DevTools traces: **PENDING (controller)**

Settings for both production URLs: emulate 412x915 @2.625, Slow 4G, 4x CPU, cold-cache reload, page load only. Record TTFB, FCP, LCP with breakdown (TTFB / load delay / load time / render delay), CLS, critical-path latency, scripts, and DevTools insights. Also run one trace per app of "type one sentence, main visible" (1 billed translation each, 2 total). Summaries go to `data/2026-11-04-devtools-{ts,go}.json`.

| Metric (lab)                                       | TS (www.neofox.dev)                                  | Go (translater-go.vercel.app) |
| -------------------------------------------------- | ---------------------------------------------------- | ----------------------------- |
| TTFB                                               | _PENDING_ (baseline 337 ms)                          | _PENDING_                     |
| FCP                                                | _PENDING_                                            | _PENDING_                     |
| LCP (TTFB / load delay / load time / render delay) | _PENDING_ (baseline 1,729 ms, render delay 1,392 ms) | _PENDING_                     |
| CLS                                                | _PENDING_                                            | _PENDING_                     |
| Max critical-path latency                          | _PENDING_                                            | _PENDING_                     |
| Scripts                                            | _PENDING_                                            | _PENDING_                     |
| Insights                                           | _PENDING_                                            | _PENDING_                     |
| Type one sentence, main visible                    | _PENDING_                                            | _PENDING_                     |

## Recommendation: **PENDING (controller, after DevTools traces and Task 32)**

Caveats to weigh:

- The Go runtime is Beta on Vercel.
- Go's Vercel function cannot cancel superseded requests, so every superseded run bills its full output (none occurred in these scenarios; TS paid for 14 fragments instead).
- The Go function runs in `iad1`, TS in `icn1` (left as deployed); the live translation timings include that.
- The live page-load advantage is partly hosting: TS sits behind Cloudflare with an extra TLS hop.
- Parity exceptions from Task 32's sign-off.
- The Safari modulepreload recovery note (Task 17 checkpoint).
- The shared TS behaviours kept in both apps by user decision (Escape clears the source outside open panels; compact synonym focus).

## Full tables: live runs

Generated by `npx tsx e2e/perf/table.ts docs/superpowers/reports/data/2026-11-04-final-ts-live.json docs/superpowers/reports/data/2026-11-04-final-go-live.json`. Live mode cannot count upstream requests or check the fixture text (flag rows that need them show n/a); "Translation requests sent by the page" is the billed count.

#### iphone-webkit-slow4g

iPhone 15, WebKit, Lighthouse mobile network via the throttle proxy; CPU unthrottled (WebKit cannot be CPU-throttled)

##### Page load, cold cache

| Metric                                          | ts (live) median / p90 | go (live) median / p90 |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| TTFB                                            | 2725 ms / 3857 ms      | 1774 ms / 1776 ms      |
| Document transfer (responseEnd - responseStart) | 21 ms / 23 ms          | 250 ms / 270 ms        |
| Document transfer expected on the link          | 27 ms / 27 ms          | 44 ms / 44 ms          |
| FCP                                             | 6119 ms / 9555 ms      | 2909 ms / 2959 ms      |
| LCP                                             | 6119 ms / 9555 ms      | 2909 ms / 2959 ms      |
| TBT (FCP to quiet)                              | n/a                    | n/a                    |
| DOMContentLoaded                                | 6122 ms / 9557 ms      | 3617 ms / 3678 ms      |
| load event                                      | 9209 ms / 12906 ms     | 5549 ms / 5600 ms      |
| CLS during load                                 | n/a                    | n/a                    |
| **JS total gzip (external + inline)**           | 303.9 KiB / 303.9 KiB  | 44.8 KiB / 44.8 KiB    |
| JS total raw (external + inline)                | 962.3 KiB / 962.3 KiB  | 109.9 KiB / 109.9 KiB  |
| JS external raw                                 | 958.7 KiB / 958.7 KiB  | 109.9 KiB / 109.9 KiB  |
| JS external transferred (incl. headers)         | 312.7 KiB / 312.7 KiB  | 54.5 KiB / 54.5 KiB    |
| JS external gzip -9                             | 302.3 KiB / 302.3 KiB  | 44.8 KiB / 44.8 KiB    |
| JS inline raw                                   | 3687 B / 3687 B        | 0 B / 0 B              |
| JS inline gzip -9                               | 1645 B / 1646 B        | 0 B / 0 B              |
| Inline data scripts raw (JSON)                  | 0 B / 0 B              | 6317 B / 6317 B        |
| CSS external raw                                | 141.3 KiB / 141.3 KiB  | 141.1 KiB / 141.1 KiB  |
| CSS external transferred (incl. headers)        | 29.9 KiB / 29.9 KiB    | 29.8 KiB / 29.8 KiB    |
| CSS external gzip -9                            | 28.3 KiB / 28.3 KiB    | 28.2 KiB / 28.2 KiB    |
| CSS inline raw                                  | 0 B / 0 B              | 0 B / 0 B              |
| CSS inline gzip -9                              | 0 B / 0 B              | 0 B / 0 B              |
| HTML raw                                        | 16.8 KiB / 16.8 KiB    | 36.8 KiB / 36.8 KiB    |
| HTML transferred (incl. headers)                | 5134 B / 5134 B        | 8345 B / 8345 B        |
| All transferred (incl. headers)                 | 505.0 KiB / 505.0 KiB  | 249.5 KiB / 249.5 KiB  |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric                                                                                              | ts (live) median / p90  | go (live) median / p90 |
| --------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------- |
| **First typeable (kept and acted on)**                                                              | n/a                     | 2938 ms / 2948 ms      |
| Gate: typing at first focus wiped                                                                   | 10/10 yes               | 0/10 yes               |
| Gate: typing at first focus ignored                                                                 | 0/10 yes                | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request)                                         | 5/10 yes                | 0/10 yes               |
| Translation requests sent by the page                                                               | 2 / 2                   | 1 / 1                  |
| First focus (burst first keystroke)                                                                 | 6652 ms / 12010 ms      | 2938 ms / 2948 ms      |
| Nav start to first main char, typing at first focus (dropped runs: after the retype)                | 18348 ms / 23504 ms     | 6097 ms / 6245 ms      |
| Input kept from (max(FCP, earliest kept keystroke), space probe)                                    | 7255 ms / 9079 ms       | 2949 ms / 3020 ms      |
| **First typeable (kept and acted on)** (repeat visit)                                               | 1845 ms / 2266 ms (n=2) | 879 ms / 893 ms        |
| Gate: typing at first focus wiped (repeat visit)                                                    | 8/10 yes                | 0/10 yes               |
| Gate: typing at first focus ignored (repeat visit)                                                  | 0/10 yes                | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request) (repeat visit)                          | 8/10 yes                | 0/10 yes               |
| Translation requests sent by the page (repeat visit)                                                | 2 / 2                   | 1 / 1                  |
| First focus (burst first keystroke) (repeat visit)                                                  | 1715 ms / 2342 ms       | 879 ms / 893 ms        |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 14223 ms / 19662 ms     | 3249 ms / 3476 ms      |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric                                                               | ts (live) median / p90    | go (live) median / p90 |
| -------------------------------------------------------------------- | ------------------------- | ---------------------- |
| First typeable incl. the retype model                                | 14244 ms / 19025 ms       | 2938 ms / 2948 ms      |
| of which harness wait (settle point - input kept from), dropped runs | 7229 ms / 11262 ms        | n/a                    |
| Harness settle point, dropped runs                                   | 14185 ms / 18970 ms       | n/a                    |
| Clear + retype after settle, dropped runs                            | 64 ms / 73 ms             | n/a                    |
| First typeable incl. the retype model (repeat visit)                 | 10634 ms / 13866 ms       | 879 ms / 893 ms        |
| Harness settle point, dropped runs (repeat visit)                    | 11256 ms / 15368 ms (n=8) | n/a                    |
| Clear + retype after settle, dropped runs (repeat visit)             | 60 ms / 88 ms (n=8)       | n/a                    |

##### Page load, repeat visit (same context, warm cache)

| Metric                                          | ts (live) median / p90 | go (live) median / p90 |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| TTFB (repeat)                                   | 1128 ms / 1324 ms      | 574 ms / 577 ms        |
| FCP (repeat)                                    | 1232 ms / 1806 ms      | 855 ms / 913 ms        |
| LCP (repeat)                                    | 1232 ms / 1806 ms      | 855 ms / 913 ms        |
| TBT (FCP to quiet) (repeat)                     | n/a                    | n/a                    |
| DOMContentLoaded (repeat)                       | 1226 ms / 1799 ms      | 867 ms / 926 ms        |
| load event (repeat)                             | 1233 ms / 1808 ms      | 867 ms / 927 ms        |
| CLS during load (repeat)                        | n/a                    | n/a                    |
| JS external transferred (repeat; 0 = cache hit) | 340 B / 340 B          | 0 B / 0 B              |
| All transferred (repeat)                        | 6016 B / 6017 B        | 8345 B / 8345 B        |

##### Translation on the settled page

| Metric                                                      | ts (live) median / p90 | go (live) median / p90 |
| ----------------------------------------------------------- | ---------------------- | ---------------------- |
| Last key to first main char                                 | 4345 ms / 9258 ms      | 2263 ms / 2500 ms      |
| Last key to Copy enabled                                    | 4424 ms / 10242 ms     | 2359 ms / 2528 ms      |
| Last key to done (stream ended + Copy + DOM quiet 500 ms)   | 7071 ms / 12631 ms     | 4882 ms / 5069 ms      |
| Translation requests sent by the page                       | 1 / 1                  | 1 / 1                  |
| Request end minus last DOM change (> 0: response held open) | -17 ms / -9 ms         | 167 ms / 177 ms        |
| Diagnostic: last key to Listen enabled (if the app has it)  | 7071 ms / 12631 ms     | 4716 ms / 4897 ms      |
| JS loaded through done, gzip -9                             | 303.9 KiB / 303.9 KiB  | 44.8 KiB / 44.8 KiB    |
| JS loaded through done, raw                                 | 962.3 KiB / 962.3 KiB  | 109.9 KiB / 109.9 KiB  |

##### Keyboard open (simulated; dy is not "lower is better", read it with visibility)

| Metric                                                                               | ts (live) median / p90 | go (live) median / p90 |
| ------------------------------------------------------------------------------------ | ---------------------- | ---------------------- |
| visualViewport shrink + pan: final visual viewport offsetTop (scroll-to-caret model) | 0 px / 0 px            | 0 px / 0 px            |
| visualViewport shrink + pan: layout-shift sum                                        | n/a                    | n/a                    |
| visualViewport shrink + pan: main text dy                                            | 99 px / 99 px          | 99 px / 99 px          |
| visualViewport shrink + pan: source textarea dy                                      | 323 px / 323 px        | 323 px / 323 px        |
| visualViewport shrink + pan: main text visible                                       | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: textarea visible                                        | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: caret visible                                           | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: textarea keeps focus                                    | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: final visual viewport offsetTop (scroll-to-caret model)      | n/a                    | n/a                    |
| Layout viewport resize: layout-shift sum                                             | n/a                    | n/a                    |
| Layout viewport resize: main text dy                                                 | 99 px / 99 px          | 99 px / 99 px          |
| Layout viewport resize: source textarea dy                                           | 323 px / 323 px        | 323 px / 323 px        |
| Layout viewport resize: main text visible                                            | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: textarea visible                                             | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: caret visible                                                | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: textarea keeps focus                                         | 10/10 yes              | 10/10 yes              |

##### Diagnostics: space probe during load

| Metric                                 | ts (live) median / p90 | go (live) median / p90 |
| -------------------------------------- | ---------------------- | ---------------------- |
| Earliest kept keystroke                | 7255 ms / 9079 ms      | 2949 ms / 3020 ms      |
| Earliest keystroke shown (may be lost) | 5890 ms / 7516 ms      | 2949 ms / 3020 ms      |
| Probe resolution (kept - last lost)    | 81 ms / 86 ms          | n/a                    |
| Whitespace input reached upstream      | n/a                    | n/a                    |

#### pixel-chromium-4xcpu-slow4g

Pixel 7, Chromium, 4x CPU (CDP) + Lighthouse mobile network via the throttle proxy

##### Page load, cold cache

| Metric                                          | ts (live) median / p90 | go (live) median / p90 |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| TTFB                                            | 2752 ms / 6634 ms      | 1772 ms / 1778 ms      |
| Document transfer (responseEnd - responseStart) | 23 ms / 1672 ms        | 247 ms / 279 ms        |
| Document transfer expected on the link          | 27 ms / 27 ms          | 44 ms / 44 ms          |
| FCP                                             | 4930 ms / 15252 ms     | 2912 ms / 3008 ms      |
| LCP                                             | 4930 ms / 15252 ms     | 2912 ms / 3008 ms      |
| TBT (FCP to quiet)                              | 25 ms / 27 ms          | 0 ms / 0 ms            |
| DOMContentLoaded                                | 5242 ms / 15251 ms     | 5988 ms / 6066 ms      |
| load event                                      | 8445 ms / 17883 ms     | 5989 ms / 6066 ms      |
| CLS during load                                 | 0.000 / 0.000          | 0.000 / 0.000          |
| **JS total gzip (external + inline)**           | 303.9 KiB / 303.9 KiB  | 44.8 KiB / 44.8 KiB    |
| JS total raw (external + inline)                | 962.3 KiB / 962.3 KiB  | 109.9 KiB / 109.9 KiB  |
| JS external raw                                 | 958.7 KiB / 958.7 KiB  | 109.9 KiB / 109.9 KiB  |
| JS external transferred (incl. headers)         | 312.3 KiB / 312.3 KiB  | 54.0 KiB / 54.0 KiB    |
| JS external gzip -9                             | 302.3 KiB / 302.3 KiB  | 44.8 KiB / 44.8 KiB    |
| JS inline raw                                   | 3687 B / 3687 B        | 0 B / 0 B              |
| JS inline gzip -9                               | 1645 B / 1649 B        | 0 B / 0 B              |
| Inline data scripts raw (JSON)                  | 0 B / 0 B              | 6317 B / 6317 B        |
| CSS external raw                                | 141.3 KiB / 141.3 KiB  | 141.1 KiB / 141.1 KiB  |
| CSS external transferred (incl. headers)        | 29.9 KiB / 29.9 KiB    | 29.7 KiB / 29.7 KiB    |
| CSS external gzip -9                            | 28.3 KiB / 28.3 KiB    | 28.2 KiB / 28.2 KiB    |
| CSS inline raw                                  | 0 B / 0 B              | 0 B / 0 B              |
| CSS inline gzip -9                              | 0 B / 0 B              | 0 B / 0 B              |
| HTML raw                                        | 16.8 KiB / 16.8 KiB    | 36.8 KiB / 36.8 KiB    |
| HTML transferred (incl. headers)                | 5116 B / 5117 B        | 8309 B / 8309 B        |
| All transferred (incl. headers)                 | 504.6 KiB / 504.6 KiB  | 249.0 KiB / 249.0 KiB  |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric                                                                                              | ts (live) median / p90 | go (live) median / p90 |
| --------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------- |
| **First typeable (kept and acted on)**                                                              | n/a                    | 2898 ms / 3008 ms      |
| Gate: typing at first focus wiped                                                                   | 10/10 yes              | 0/10 yes               |
| Gate: typing at first focus ignored                                                                 | 0/10 yes               | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request)                                         | 0/10 yes               | 0/10 yes               |
| Translation requests sent by the page                                                               | 1 / 1                  | 1 / 1                  |
| First focus (burst first keystroke)                                                                 | 5522 ms / 7414 ms      | 2153 ms / 2186 ms      |
| Nav start to first main char, typing at first focus (dropped runs: after the retype)                | 15761 ms / 18026 ms    | 8507 ms / 9796 ms      |
| Input kept from (max(FCP, earliest kept keystroke), space probe)                                    | 8410 ms / 13909 ms     | 2956 ms / 3008 ms      |
| **First typeable (kept and acted on)** (repeat visit)                                               | n/a                    | 913 ms / 998 ms        |
| Gate: typing at first focus wiped (repeat visit)                                                    | 10/10 yes              | 0/10 yes               |
| Gate: typing at first focus ignored (repeat visit)                                                  | 0/10 yes               | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request) (repeat visit)                          | 0/10 yes               | 0/10 yes               |
| Translation requests sent by the page (repeat visit)                                                | 1 / 1                  | 1 / 1                  |
| First focus (burst first keystroke) (repeat visit)                                                  | 1855 ms / 2974 ms      | 913 ms / 998 ms        |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 8889 ms / 9923 ms      | 3307 ms / 3465 ms      |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric                                                               | ts (live) median / p90 | go (live) median / p90 |
| -------------------------------------------------------------------- | ---------------------- | ---------------------- |
| First typeable incl. the retype model                                | 11679 ms / 14171 ms    | 2898 ms / 3008 ms      |
| of which harness wait (settle point - input kept from), dropped runs | 2646 ms / 5719 ms      | n/a                    |
| Harness settle point, dropped runs                                   | 11564 ms / 14068 ms    | n/a                    |
| Clear + retype after settle, dropped runs                            | 99 ms / 119 ms         | n/a                    |
| First typeable incl. the retype model (repeat visit)                 | 4176 ms / 5668 ms      | 913 ms / 998 ms        |
| Harness settle point, dropped runs (repeat visit)                    | 4087 ms / 5571 ms      | n/a                    |
| Clear + retype after settle, dropped runs (repeat visit)             | 95 ms / 103 ms         | n/a                    |

##### Page load, repeat visit (same context, warm cache)

| Metric                                          | ts (live) median / p90 | go (live) median / p90 |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| TTFB (repeat)                                   | 1158 ms / 2247 ms      | 573 ms / 574 ms        |
| FCP (repeat)                                    | 1246 ms / 2700 ms      | 884 ms / 956 ms        |
| LCP (repeat)                                    | 1246 ms / 2700 ms      | 884 ms / 956 ms        |
| TBT (FCP to quiet) (repeat)                     | 0 ms / 0 ms            | 0 ms / 0 ms            |
| DOMContentLoaded (repeat)                       | 1247 ms / 2684 ms      | 900 ms / 955 ms        |
| load event (repeat)                             | 1266 ms / 2703 ms      | 901 ms / 956 ms        |
| CLS during load (repeat)                        | 0.000 / 0.000          | 0.000 / 0.000          |
| JS external transferred (repeat; 0 = cache hit) | 354 B / 354 B          | 0 B / 0 B              |
| All transferred (repeat)                        | 11.9 KiB / 11.9 KiB    | 14.4 KiB / 14.4 KiB    |

##### Translation on the settled page

| Metric                                                      | ts (live) median / p90 | go (live) median / p90 |
| ----------------------------------------------------------- | ---------------------- | ---------------------- |
| Last key to first main char                                 | 3620 ms / 4949 ms      | 2115 ms / 2188 ms      |
| Last key to Copy enabled                                    | 4031 ms / 5181 ms      | 2251 ms / 2323 ms      |
| Last key to done (stream ended + Copy + DOM quiet 500 ms)   | 6416 ms / 10965 ms     | 4873 ms / 5230 ms      |
| Translation requests sent by the page                       | 1 / 1                  | 1 / 1                  |
| Request end minus last DOM change (> 0: response held open) | -32 ms / -28 ms        | 158 ms / 190 ms        |
| Diagnostic: last key to Listen enabled (if the app has it)  | 6416 ms / 10965 ms     | 4726 ms / 5066 ms      |
| JS loaded through done, gzip -9                             | 303.9 KiB / 303.9 KiB  | 44.8 KiB / 44.8 KiB    |
| JS loaded through done, raw                                 | 962.3 KiB / 962.3 KiB  | 109.9 KiB / 109.9 KiB  |

##### Keyboard open (simulated; dy is not "lower is better", read it with visibility)

| Metric                                                                               | ts (live) median / p90 | go (live) median / p90 |
| ------------------------------------------------------------------------------------ | ---------------------- | ---------------------- |
| visualViewport shrink + pan: final visual viewport offsetTop (scroll-to-caret model) | 0 px / 0 px            | 0 px / 0 px            |
| visualViewport shrink + pan: layout-shift sum                                        | 0.259 / 0.265          | 0.246 / 0.246          |
| visualViewport shrink + pan: main text dy                                            | 58 px / 58 px          | 58 px / 58 px          |
| visualViewport shrink + pan: source textarea dy                                      | 413 px / 413 px        | 413 px / 413 px        |
| visualViewport shrink + pan: main text visible                                       | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: textarea visible                                        | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: caret visible                                           | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: textarea keeps focus                                    | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: final visual viewport offsetTop (scroll-to-caret model)      | n/a                    | n/a                    |
| Layout viewport resize: layout-shift sum                                             | 0.533 / 0.545          | 0.501 / 0.511          |
| Layout viewport resize: main text dy                                                 | 58 px / 58 px          | 58 px / 58 px          |
| Layout viewport resize: source textarea dy                                           | 413 px / 413 px        | 413 px / 413 px        |
| Layout viewport resize: main text visible                                            | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: textarea visible                                             | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: caret visible                                                | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: textarea keeps focus                                         | 10/10 yes              | 10/10 yes              |

##### Diagnostics: space probe during load

| Metric                                 | ts (live) median / p90 | go (live) median / p90 |
| -------------------------------------- | ---------------------- | ---------------------- |
| Earliest kept keystroke                | 8410 ms / 13909 ms     | 2155 ms / 2179 ms      |
| Earliest keystroke shown (may be lost) | 4903 ms / 5493 ms      | 2155 ms / 2179 ms      |
| Probe resolution (kept - last lost)    | 189 ms / 195 ms        | n/a                    |
| Whitespace input reached upstream      | n/a                    | n/a                    |

#### macbook-chromium

MacBook 14" (1512x982 @2x), Chromium, unthrottled, direct connection

##### Page load, cold cache

| Metric                                          | ts (live) median / p90 | go (live) median / p90 |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| TTFB                                            | 1266 ms / 2424 ms      | 36 ms / 50 ms          |
| Document transfer (responseEnd - responseStart) | 2 ms / 1045 ms         | 206 ms / 214 ms        |
| Document transfer expected on the link          | n/a                    | n/a                    |
| FCP                                             | 3006 ms / 4836 ms      | 312 ms / 332 ms        |
| LCP                                             | 3006 ms / 4836 ms      | 312 ms / 332 ms        |
| TBT (FCP to quiet)                              | 0 ms / 0 ms            | 0 ms / 0 ms            |
| DOMContentLoaded                                | 2999 ms / 4828 ms      | 330 ms / 393 ms        |
| load event                                      | 3572 ms / 4916 ms      | 350 ms / 420 ms        |
| CLS during load                                 | 0.000 / 0.000          | 0.000 / 0.000          |
| **JS total gzip (external + inline)**           | 303.9 KiB / 303.9 KiB  | 44.8 KiB / 44.8 KiB    |
| JS total raw (external + inline)                | 962.3 KiB / 962.3 KiB  | 109.9 KiB / 109.9 KiB  |
| JS external raw                                 | 958.7 KiB / 958.7 KiB  | 109.9 KiB / 109.9 KiB  |
| JS external transferred (incl. headers)         | 312.3 KiB / 312.3 KiB  | 54.0 KiB / 54.0 KiB    |
| JS external gzip -9                             | 302.3 KiB / 302.3 KiB  | 44.8 KiB / 44.8 KiB    |
| JS inline raw                                   | 3687 B / 3687 B        | 0 B / 0 B              |
| JS inline gzip -9                               | 1645 B / 1648 B        | 0 B / 0 B              |
| Inline data scripts raw (JSON)                  | 0 B / 0 B              | 6317 B / 6317 B        |
| CSS external raw                                | 141.3 KiB / 141.3 KiB  | 141.1 KiB / 141.1 KiB  |
| CSS external transferred (incl. headers)        | 29.9 KiB / 29.9 KiB    | 29.7 KiB / 29.7 KiB    |
| CSS external gzip -9                            | 28.3 KiB / 28.3 KiB    | 28.2 KiB / 28.2 KiB    |
| CSS inline raw                                  | 0 B / 0 B              | 0 B / 0 B              |
| CSS inline gzip -9                              | 0 B / 0 B              | 0 B / 0 B              |
| HTML raw                                        | 16.8 KiB / 16.8 KiB    | 36.8 KiB / 36.8 KiB    |
| HTML transferred (incl. headers)                | 5116 B / 5117 B        | 8309 B / 8309 B        |
| All transferred (incl. headers)                 | 504.9 KiB / 504.9 KiB  | 249.2 KiB / 249.3 KiB  |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric                                                                                              | ts (live) median / p90  | go (live) median / p90 |
| --------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------- |
| **First typeable (kept and acted on)**                                                              | n/a                     | 306 ms / 312 ms        |
| Gate: typing at first focus wiped                                                                   | 10/10 yes               | 0/10 yes               |
| Gate: typing at first focus ignored                                                                 | 0/10 yes                | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request)                                         | 0/10 yes                | 0/10 yes               |
| Translation requests sent by the page                                                               | 1 / 1                   | 1 / 1                  |
| First focus (burst first keystroke)                                                                 | 2600 ms / 4772 ms       | 292 ms / 299 ms        |
| Nav start to first main char, typing at first focus (dropped runs: after the retype)                | 10742 ms / 15346 ms     | 2065 ms / 2538 ms      |
| Input kept from (max(FCP, earliest kept keystroke), space probe)                                    | 5021 ms / 9360 ms       | 312 ms / 340 ms        |
| **First typeable (kept and acted on)** (repeat visit)                                               | 2204 ms / 5168 ms (n=4) | 247 ms / 321 ms        |
| Gate: typing at first focus wiped (repeat visit)                                                    | 6/10 yes                | 0/10 yes               |
| Gate: typing at first focus ignored (repeat visit)                                                  | 0/10 yes                | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request) (repeat visit)                          | 1/10 yes                | 0/10 yes               |
| Translation requests sent by the page (repeat visit)                                                | 1 / 1                   | 1 / 1                  |
| First focus (burst first keystroke) (repeat visit)                                                  | 1678 ms / 4080 ms       | 247 ms / 321 ms        |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 7751 ms / 11654 ms      | 1867 ms / 2116 ms      |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric                                                               | ts (live) median / p90  | go (live) median / p90 |
| -------------------------------------------------------------------- | ----------------------- | ---------------------- |
| First typeable incl. the retype model                                | 7254 ms / 11872 ms      | 306 ms / 312 ms        |
| of which harness wait (settle point - input kept from), dropped runs | 2375 ms / 6606 ms       | n/a                    |
| Harness settle point, dropped runs                                   | 7187 ms / 11809 ms      | n/a                    |
| Clear + retype after settle, dropped runs                            | 64 ms / 73 ms           | n/a                    |
| First typeable incl. the retype model (repeat visit)                 | 3960 ms / 5559 ms       | 247 ms / 321 ms        |
| Harness settle point, dropped runs (repeat visit)                    | 4706 ms / 8249 ms (n=6) | n/a                    |
| Clear + retype after settle, dropped runs (repeat visit)             | 67 ms / 79 ms (n=6)     | n/a                    |

##### Page load, repeat visit (same context, warm cache)

| Metric                                          | ts (live) median / p90 | go (live) median / p90 |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| TTFB (repeat)                                   | 547 ms / 885 ms        | 9 ms / 10 ms           |
| FCP (repeat)                                    | 606 ms / 4644 ms       | 242 ms / 324 ms        |
| LCP (repeat)                                    | 606 ms / 4644 ms       | 242 ms / 324 ms        |
| TBT (FCP to quiet) (repeat)                     | 0 ms / 0 ms            | 0 ms / 0 ms            |
| DOMContentLoaded (repeat)                       | 922 ms / 4638 ms       | 241 ms / 322 ms        |
| load event (repeat)                             | 933 ms / 4638 ms       | 241 ms / 322 ms        |
| CLS during load (repeat)                        | 0.000 / 0.000          | 0.000 / 0.000          |
| JS external transferred (repeat; 0 = cache hit) | 354 B / 354 B          | 0 B / 0 B              |
| All transferred (repeat)                        | 12.3 KiB / 12.3 KiB    | 14.7 KiB / 14.7 KiB    |

##### Translation on the settled page

| Metric                                                      | ts (live) median / p90 | go (live) median / p90 |
| ----------------------------------------------------------- | ---------------------- | ---------------------- |
| Last key to first main char                                 | 3018 ms / 4363 ms      | 1659 ms / 2029 ms      |
| Last key to Copy enabled                                    | 3208 ms / 4363 ms      | 1786 ms / 2149 ms      |
| Last key to done (stream ended + Copy + DOM quiet 500 ms)   | 6216 ms / 8833 ms      | 4415 ms / 4885 ms      |
| Translation requests sent by the page                       | 1 / 1                  | 1 / 1                  |
| Request end minus last DOM change (> 0: response held open) | -16 ms / -9 ms         | 175 ms / 207 ms        |
| Diagnostic: last key to Listen enabled (if the app has it)  | 6216 ms / 8833 ms      | 4249 ms / 4697 ms      |
| JS loaded through done, gzip -9                             | 303.9 KiB / 303.9 KiB  | 44.8 KiB / 44.8 KiB    |
| JS loaded through done, raw                                 | 962.3 KiB / 962.3 KiB  | 109.9 KiB / 109.9 KiB  |

##### Diagnostics: space probe during load

| Metric                                 | ts (live) median / p90 | go (live) median / p90 |
| -------------------------------------- | ---------------------- | ---------------------- |
| Earliest kept keystroke                | 5021 ms / 9360 ms      | 291 ms / 299 ms        |
| Earliest keystroke shown (may be lost) | 2820 ms / 6534 ms      | 291 ms / 299 ms        |
| Probe resolution (kept - last lost)    | 55 ms / 63 ms          | n/a                    |
| Whitespace input reached upstream      | n/a                    | n/a                    |

#### Server TTFB (Node client, no browser)

| Metric               | ts (live) median / p90 | go (live) median / p90 |
| -------------------- | ---------------------- | ---------------------- |
| Cold (first request) | 1360 ms / 1360 ms      | 455 ms / 455 ms        |
| Warm                 | 1155 ms / 1424 ms      | 246 ms / 443 ms        |

- ts (live): Deployed URL: "cold" is only the first request of this session (a cold instance is likely but not guaranteed); warm = later requests 200 ms apart. Node client from this machine, includes network RTT.
- go (live): Deployed URL: "cold" is only the first request of this session (a cold instance is likely but not guaranteed); warm = later requests 200 ms apart. Node client from this machine, includes network RTT.

#### Measured on

- ts (live): 2026-11-04T07:46:11.187Z, commit 0968bde39fcc (dirty), harness dd731a369455, Apple M1 Max, 10 cores, 32 GiB, darwin 27.0.0 arm64, Playwright 1.64.1, webkit 27.2, chromium 156.0.8078.4
- go (live): 2026-11-04T09:31:01.587Z, commit 56fd91bd31c8 (dirty), harness dd731a369455, Apple M1 Max, 10 cores, 32 GiB, darwin 27.0.0 arm64, Playwright 1.64.1, webkit 27.2, chromium 156.0.8078.4

## Full tables: fake runs

Generated by `npx tsx e2e/perf/table.ts docs/superpowers/reports/data/2026-11-04-final-ts-fake.json docs/superpowers/reports/data/2026-11-04-final-go-fake.json`.

#### iphone-webkit-slow4g

iPhone 15, WebKit, Lighthouse mobile network via the throttle proxy; CPU unthrottled (WebKit cannot be CPU-throttled)

##### Page load, cold cache

| Metric                                          | ts (fake) median / p90  | go (fake) median / p90 |
| ----------------------------------------------- | ----------------------- | ---------------------- |
| TTFB                                            | 1141 ms / 1149 ms       | 1140 ms / 1148 ms      |
| Document transfer (responseEnd - responseStart) | 89 ms / 90 ms           | 196 ms / 199 ms        |
| Document transfer expected on the link          | 91 ms / 91 ms           | 201 ms / 201 ms        |
| FCP                                             | 2583 ms / 2592 ms       | 2552 ms / 2562 ms      |
| LCP                                             | 2583 ms / 2592 ms       | 2552 ms / 2562 ms      |
| TBT (FCP to quiet)                              | n/a                     | n/a                    |
| DOMContentLoaded                                | 2543 ms / 2554 ms       | 4547 ms / 4567 ms      |
| load event                                      | 4462 ms / 4472 ms       | 4547 ms / 4567 ms      |
| CLS during load                                 | n/a                     | n/a                    |
| **JS total gzip (external + inline)**           | 285.3 KiB / 285.3 KiB   | 42.8 KiB / 42.8 KiB    |
| JS total raw (external + inline)                | 907.4 KiB / 907.4 KiB   | 105.5 KiB / 105.5 KiB  |
| JS external raw                                 | 903.8 KiB / 903.8 KiB   | 105.5 KiB / 105.5 KiB  |
| JS external transferred (incl. headers)         | 904.3 KiB / 904.3 KiB   | 111.3 KiB / 111.3 KiB  |
| JS external gzip -9                             | 283.7 KiB / 283.7 KiB   | 42.8 KiB / 42.8 KiB    |
| JS inline raw                                   | 3687 B / 3687 B         | 0 B / 0 B              |
| JS inline gzip -9                               | 1644 B / 1644 B         | 0 B / 0 B              |
| Inline data scripts raw (JSON)                  | 0 B / 0 B               | 6317 B / 6317 B        |
| CSS external raw                                | 146.5 KiB / 146.5 KiB   | 141.1 KiB / 141.1 KiB  |
| CSS external transferred (incl. headers)        | 146.8 KiB / 146.8 KiB   | 141.4 KiB / 141.4 KiB  |
| CSS external gzip -9                            | 29.2 KiB / 29.2 KiB     | 28.2 KiB / 28.2 KiB    |
| CSS inline raw                                  | 0 B / 0 B               | 0 B / 0 B              |
| CSS inline gzip -9                              | 0 B / 0 B               | 0 B / 0 B              |
| HTML raw                                        | 16.5 KiB / 16.5 KiB     | 36.7 KiB / 36.7 KiB    |
| HTML transferred (incl. headers)                | 16.9 KiB / 16.9 KiB     | 37.1 KiB / 37.1 KiB    |
| All transferred (incl. headers)                 | 1068.0 KiB / 1068.0 KiB | 289.8 KiB / 289.8 KiB  |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric                                                                                              | ts (fake) median / p90 | go (fake) median / p90 |
| --------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------- |
| **First typeable (kept and acted on)**                                                              | n/a                    | 2564 ms / 2572 ms      |
| Gate: typing at first focus wiped                                                                   | 10/10 yes              | 0/10 yes               |
| Gate: typing at first focus ignored                                                                 | 0/10 yes               | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request)                                         | 0/10 yes               | 0/10 yes               |
| Translation requests sent by the page                                                               | 1 / 1                  | 1 / 1                  |
| First focus (burst first keystroke)                                                                 | 2595 ms / 2607 ms      | 2564 ms / 2572 ms      |
| Nav start to first main char, typing at first focus (dropped runs: after the retype)                | 10525 ms / 10564 ms    | 5816 ms / 5831 ms      |
| Input kept from (max(FCP, earliest kept keystroke), space probe)                                    | 7498 ms / 7504 ms      | 2558 ms / 2561 ms      |
| **First typeable (kept and acted on)** (repeat visit)                                               | n/a                    | 725 ms / 729 ms        |
| Gate: typing at first focus wiped (repeat visit)                                                    | 10/10 yes              | 0/10 yes               |
| Gate: typing at first focus ignored (repeat visit)                                                  | 0/10 yes               | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request) (repeat visit)                          | 10/10 yes              | 0/10 yes               |
| Translation requests sent by the page (repeat visit)                                                | 2 / 2                  | 1 / 1                  |
| First focus (burst first keystroke) (repeat visit)                                                  | 656 ms / 658 ms        | 725 ms / 729 ms        |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 4404 ms / 4421 ms      | 2047 ms / 2060 ms      |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric                                                               | ts (fake) median / p90 | go (fake) median / p90 |
| -------------------------------------------------------------------- | ---------------------- | ---------------------- |
| First typeable incl. the retype model                                | 9113 ms / 9145 ms      | 2564 ms / 2572 ms      |
| of which harness wait (settle point - input kept from), dropped runs | 1560 ms / 1585 ms      | n/a                    |
| Harness settle point, dropped runs                                   | 9057 ms / 9070 ms      | n/a                    |
| Clear + retype after settle, dropped runs                            | 58 ms / 84 ms          | n/a                    |
| First typeable incl. the retype model (repeat visit)                 | 3012 ms / 3021 ms      | 725 ms / 729 ms        |
| Harness settle point, dropped runs (repeat visit)                    | 2954 ms / 2962 ms      | n/a                    |
| Clear + retype after settle, dropped runs (repeat visit)             | 57 ms / 63 ms          | n/a                    |

##### Page load, repeat visit (same context, warm cache)

| Metric                                          | ts (fake) median / p90 | go (fake) median / p90 |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| TTFB (repeat)                                   | 581 ms / 586 ms        | 578 ms / 586 ms        |
| FCP (repeat)                                    | 615 ms / 621 ms        | 655 ms / 662 ms        |
| LCP (repeat)                                    | 660 ms / 665 ms        | 715 ms / 718 ms        |
| TBT (FCP to quiet) (repeat)                     | n/a                    | n/a                    |
| DOMContentLoaded (repeat)                       | 670 ms / 676 ms        | 789 ms / 792 ms        |
| load event (repeat)                             | 683 ms / 689 ms        | 789 ms / 792 ms        |
| CLS during load (repeat)                        | n/a                    | n/a                    |
| JS external transferred (repeat; 0 = cache hit) | 0 B / 0 B              | 0 B / 0 B              |
| All transferred (repeat)                        | 16.9 KiB / 16.9 KiB    | 37.1 KiB / 37.1 KiB    |

##### Translation on the settled page

| Metric                                                      | ts (fake) median / p90 | go (fake) median / p90 |
| ----------------------------------------------------------- | ---------------------- | ---------------------- |
| Last key to first main char                                 | 1258 ms / 1266 ms      | 1267 ms / 1272 ms      |
| Last key to Copy enabled                                    | 1569 ms / 1586 ms      | 1495 ms / 1499 ms      |
| Last key to done (stream ended + Copy + DOM quiet 500 ms)   | 5368 ms / 5396 ms      | 5526 ms / 5549 ms      |
| Translation requests sent by the page                       | 1 / 1                  | 1 / 1                  |
| Request end minus last DOM change (> 0: response held open) | -24 ms / -20 ms        | -20 ms / -17 ms        |
| Diagnostic: last key to Listen enabled (if the app has it)  | 5368 ms / 5396 ms      | 5526 ms / 5549 ms      |
| JS loaded through done, gzip -9                             | 285.3 KiB / 285.3 KiB  | 42.8 KiB / 42.8 KiB    |
| JS loaded through done, raw                                 | 907.4 KiB / 907.4 KiB  | 105.5 KiB / 105.5 KiB  |

##### Keyboard open (simulated; dy is not "lower is better", read it with visibility)

| Metric                                                                               | ts (fake) median / p90 | go (fake) median / p90 |
| ------------------------------------------------------------------------------------ | ---------------------- | ---------------------- |
| visualViewport shrink + pan: final visual viewport offsetTop (scroll-to-caret model) | 0 px / 0 px            | 0 px / 0 px            |
| visualViewport shrink + pan: layout-shift sum                                        | n/a                    | n/a                    |
| visualViewport shrink + pan: main text dy                                            | 99 px / 99 px          | 99 px / 99 px          |
| visualViewport shrink + pan: source textarea dy                                      | 323 px / 323 px        | 323 px / 323 px        |
| visualViewport shrink + pan: main text visible                                       | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: textarea visible                                        | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: caret visible                                           | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: textarea keeps focus                                    | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: final visual viewport offsetTop (scroll-to-caret model)      | n/a                    | n/a                    |
| Layout viewport resize: layout-shift sum                                             | n/a                    | n/a                    |
| Layout viewport resize: main text dy                                                 | 99 px / 99 px          | 99 px / 99 px          |
| Layout viewport resize: source textarea dy                                           | 323 px / 323 px        | 323 px / 323 px        |
| Layout viewport resize: main text visible                                            | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: textarea visible                                             | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: caret visible                                                | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: textarea keeps focus                                         | 10/10 yes              | 10/10 yes              |

##### Diagnostics: space probe during load

| Metric                                 | ts (fake) median / p90 | go (fake) median / p90 |
| -------------------------------------- | ---------------------- | ---------------------- |
| Earliest kept keystroke                | 7498 ms / 7504 ms      | 2558 ms / 2561 ms      |
| Earliest keystroke shown (may be lost) | 2587 ms / 2600 ms      | 2558 ms / 2561 ms      |
| Probe resolution (kept - last lost)    | 83 ms / 90 ms          | n/a                    |
| Whitespace input reached upstream      | 0/10 yes               | 0/10 yes               |

#### pixel-chromium-4xcpu-slow4g

Pixel 7, Chromium, 4x CPU (CDP) + Lighthouse mobile network via the throttle proxy

##### Page load, cold cache

| Metric                                          | ts (fake) median / p90  | go (fake) median / p90 |
| ----------------------------------------------- | ----------------------- | ---------------------- |
| TTFB                                            | 1139 ms / 1140 ms       | 1138 ms / 1141 ms      |
| Document transfer (responseEnd - responseStart) | 89 ms / 90 ms           | 199 ms / 200 ms        |
| Document transfer expected on the link          | 91 ms / 91 ms           | 201 ms / 201 ms        |
| FCP                                             | 3198 ms / 3200 ms       | 3160 ms / 3164 ms      |
| LCP                                             | 3198 ms / 3200 ms       | 3160 ms / 3164 ms      |
| TBT (FCP to quiet)                              | 21 ms / 23 ms           | 0 ms / 0 ms            |
| DOMContentLoaded                                | 3192 ms / 3195 ms       | 5105 ms / 5108 ms      |
| load event                                      | 5072 ms / 5074 ms       | 5106 ms / 5110 ms      |
| CLS during load                                 | 0.000 / 0.000           | 0.000 / 0.000          |
| **JS total gzip (external + inline)**           | 285.3 KiB / 285.3 KiB   | 42.8 KiB / 42.8 KiB    |
| JS total raw (external + inline)                | 907.4 KiB / 907.4 KiB   | 105.5 KiB / 105.5 KiB  |
| JS external raw                                 | 903.8 KiB / 903.8 KiB   | 105.5 KiB / 105.5 KiB  |
| JS external transferred (incl. headers)         | 904.3 KiB / 904.3 KiB   | 111.3 KiB / 111.3 KiB  |
| JS external gzip -9                             | 283.7 KiB / 283.7 KiB   | 42.8 KiB / 42.8 KiB    |
| JS inline raw                                   | 3687 B / 3687 B         | 0 B / 0 B              |
| JS inline gzip -9                               | 1644 B / 1645 B         | 0 B / 0 B              |
| Inline data scripts raw (JSON)                  | 0 B / 0 B               | 6317 B / 6317 B        |
| CSS external raw                                | 146.5 KiB / 146.5 KiB   | 141.1 KiB / 141.1 KiB  |
| CSS external transferred (incl. headers)        | 146.8 KiB / 146.8 KiB   | 141.4 KiB / 141.4 KiB  |
| CSS external gzip -9                            | 29.2 KiB / 29.2 KiB     | 28.2 KiB / 28.2 KiB    |
| CSS inline raw                                  | 0 B / 0 B               | 0 B / 0 B              |
| CSS inline gzip -9                              | 0 B / 0 B               | 0 B / 0 B              |
| HTML raw                                        | 16.5 KiB / 16.5 KiB     | 36.7 KiB / 36.7 KiB    |
| HTML transferred (incl. headers)                | 16.8 KiB / 16.8 KiB     | 37.0 KiB / 37.0 KiB    |
| All transferred (incl. headers)                 | 1068.2 KiB / 1068.2 KiB | 289.7 KiB / 289.7 KiB  |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric                                                                                              | ts (fake) median / p90 | go (fake) median / p90 |
| --------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------- |
| **First typeable (kept and acted on)**                                                              | n/a                    | 3142 ms / 3152 ms      |
| Gate: typing at first focus wiped                                                                   | 10/10 yes              | 0/10 yes               |
| Gate: typing at first focus ignored                                                                 | 0/10 yes               | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request)                                         | 0/10 yes               | 0/10 yes               |
| Translation requests sent by the page                                                               | 1 / 1                  | 1 / 1                  |
| First focus (burst first keystroke)                                                                 | 3208 ms / 3220 ms      | 1397 ms / 1407 ms      |
| Nav start to first main char, typing at first focus (dropped runs: after the retype)                | 11557 ms / 11590 ms    | 6381 ms / 6383 ms      |
| Input kept from (max(FCP, earliest kept keystroke), space probe)                                    | 8174 ms / 8176 ms      | 3142 ms / 3152 ms      |
| **First typeable (kept and acted on)** (repeat visit)                                               | n/a                    | 735 ms / 738 ms        |
| Gate: typing at first focus wiped (repeat visit)                                                    | 10/10 yes              | 0/10 yes               |
| Gate: typing at first focus ignored (repeat visit)                                                  | 0/10 yes               | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request) (repeat visit)                          | 1/10 yes               | 0/10 yes               |
| Translation requests sent by the page (repeat visit)                                                | 1 / 1                  | 1 / 1                  |
| First focus (burst first keystroke) (repeat visit)                                                  | 675 ms / 693 ms        | 735 ms / 738 ms        |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 4278 ms / 4834 ms      | 2123 ms / 2142 ms      |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric                                                               | ts (fake) median / p90 | go (fake) median / p90 |
| -------------------------------------------------------------------- | ---------------------- | ---------------------- |
| First typeable incl. the retype model                                | 9795 ms / 9804 ms      | 3142 ms / 3152 ms      |
| of which harness wait (settle point - input kept from), dropped runs | 1528 ms / 1534 ms      | n/a                    |
| Harness settle point, dropped runs                                   | 9701 ms / 9704 ms      | n/a                    |
| Clear + retype after settle, dropped runs                            | 95 ms / 104 ms         | n/a                    |
| First typeable incl. the retype model (repeat visit)                 | 2568 ms / 3132 ms      | 735 ms / 738 ms        |
| Harness settle point, dropped runs (repeat visit)                    | 2475 ms / 3040 ms      | n/a                    |
| Clear + retype after settle, dropped runs (repeat visit)             | 93 ms / 98 ms          | n/a                    |

##### Page load, repeat visit (same context, warm cache)

| Metric                                          | ts (fake) median / p90 | go (fake) median / p90 |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| TTFB (repeat)                                   | 581 ms / 582 ms        | 575 ms / 582 ms        |
| FCP (repeat)                                    | 620 ms / 620 ms        | 616 ms / 616 ms        |
| LCP (repeat)                                    | 664 ms / 664 ms        | 712 ms / 716 ms        |
| TBT (FCP to quiet) (repeat)                     | 0 ms / 0 ms            | 0 ms / 0 ms            |
| DOMContentLoaded (repeat)                       | 672 ms / 673 ms        | 792 ms / 793 ms        |
| load event (repeat)                             | 694 ms / 695 ms        | 794 ms / 795 ms        |
| CLS during load (repeat)                        | 0.051 / 0.061          | 0.051 / 0.051          |
| JS external transferred (repeat; 0 = cache hit) | 0 B / 0 B              | 0 B / 0 B              |
| All transferred (repeat)                        | 17.1 KiB / 17.1 KiB    | 37.0 KiB / 37.0 KiB    |

##### Translation on the settled page

| Metric                                                      | ts (fake) median / p90 | go (fake) median / p90 |
| ----------------------------------------------------------- | ---------------------- | ---------------------- |
| Last key to first main char                                 | 1264 ms / 1266 ms      | 1255 ms / 1264 ms      |
| Last key to Copy enabled                                    | 1559 ms / 1561 ms      | 1466 ms / 1469 ms      |
| Last key to done (stream ended + Copy + DOM quiet 500 ms)   | 5265 ms / 5274 ms      | 5328 ms / 5344 ms      |
| Translation requests sent by the page                       | 1 / 1                  | 1 / 1                  |
| Request end minus last DOM change (> 0: response held open) | -34 ms / -29 ms        | -23 ms / -17 ms        |
| Diagnostic: last key to Listen enabled (if the app has it)  | 5265 ms / 5274 ms      | 5328 ms / 5344 ms      |
| JS loaded through done, gzip -9                             | 285.3 KiB / 285.3 KiB  | 42.8 KiB / 42.8 KiB    |
| JS loaded through done, raw                                 | 907.4 KiB / 907.4 KiB  | 105.5 KiB / 105.5 KiB  |

##### Keyboard open (simulated; dy is not "lower is better", read it with visibility)

| Metric                                                                               | ts (fake) median / p90 | go (fake) median / p90 |
| ------------------------------------------------------------------------------------ | ---------------------- | ---------------------- |
| visualViewport shrink + pan: final visual viewport offsetTop (scroll-to-caret model) | 0 px / 0 px            | 0 px / 0 px            |
| visualViewport shrink + pan: layout-shift sum                                        | 0.258 / 0.265          | 0.246 / 0.246          |
| visualViewport shrink + pan: main text dy                                            | 58 px / 58 px          | 58 px / 58 px          |
| visualViewport shrink + pan: source textarea dy                                      | 413 px / 413 px        | 413 px / 413 px        |
| visualViewport shrink + pan: main text visible                                       | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: textarea visible                                        | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: caret visible                                           | 10/10 yes              | 10/10 yes              |
| visualViewport shrink + pan: textarea keeps focus                                    | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: final visual viewport offsetTop (scroll-to-caret model)      | n/a                    | n/a                    |
| Layout viewport resize: layout-shift sum                                             | 0.504 / 0.504          | 0.498 / 0.498          |
| Layout viewport resize: main text dy                                                 | 58 px / 58 px          | 58 px / 58 px          |
| Layout viewport resize: source textarea dy                                           | 413 px / 413 px        | 413 px / 413 px        |
| Layout viewport resize: main text visible                                            | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: textarea visible                                             | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: caret visible                                                | 10/10 yes              | 10/10 yes              |
| Layout viewport resize: textarea keeps focus                                         | 10/10 yes              | 10/10 yes              |

##### Diagnostics: space probe during load

| Metric                                 | ts (fake) median / p90 | go (fake) median / p90 |
| -------------------------------------- | ---------------------- | ---------------------- |
| Earliest kept keystroke                | 8174 ms / 8176 ms      | 1395 ms / 1399 ms      |
| Earliest keystroke shown (may be lost) | 3204 ms / 3212 ms      | 1395 ms / 1399 ms      |
| Probe resolution (kept - last lost)    | 189 ms / 197 ms        | n/a                    |
| Whitespace input reached upstream      | 0/10 yes               | 0/10 yes               |

#### macbook-chromium

MacBook 14" (1512x982 @2x), Chromium, unthrottled, direct connection

##### Page load, cold cache

| Metric                                          | ts (fake) median / p90  | go (fake) median / p90 |
| ----------------------------------------------- | ----------------------- | ---------------------- |
| TTFB                                            | 3 ms / 4 ms             | 2 ms / 2 ms            |
| Document transfer (responseEnd - responseStart) | 0 ms / 0 ms             | 0 ms / 1 ms            |
| Document transfer expected on the link          | n/a                     | n/a                    |
| FCP                                             | 44 ms / 44 ms           | 40 ms / 44 ms          |
| LCP                                             | 44 ms / 44 ms           | 40 ms / 44 ms          |
| TBT (FCP to quiet)                              | 0 ms / 0 ms             | 0 ms / 0 ms            |
| DOMContentLoaded                                | 35 ms / 36 ms           | 49 ms / 50 ms          |
| load event                                      | 53 ms / 55 ms           | 49 ms / 50 ms          |
| CLS during load                                 | 0.000 / 0.000           | 0.000 / 0.000          |
| **JS total gzip (external + inline)**           | 285.3 KiB / 285.3 KiB   | 42.8 KiB / 42.8 KiB    |
| JS total raw (external + inline)                | 907.4 KiB / 907.4 KiB   | 105.5 KiB / 105.5 KiB  |
| JS external raw                                 | 903.8 KiB / 903.8 KiB   | 105.5 KiB / 105.5 KiB  |
| JS external transferred (incl. headers)         | 904.3 KiB / 904.3 KiB   | 111.3 KiB / 111.3 KiB  |
| JS external gzip -9                             | 283.7 KiB / 283.7 KiB   | 42.8 KiB / 42.8 KiB    |
| JS inline raw                                   | 3687 B / 3687 B         | 0 B / 0 B              |
| JS inline gzip -9                               | 1644 B / 1644 B         | 0 B / 0 B              |
| Inline data scripts raw (JSON)                  | 0 B / 0 B               | 6317 B / 6317 B        |
| CSS external raw                                | 146.5 KiB / 146.5 KiB   | 141.1 KiB / 141.1 KiB  |
| CSS external transferred (incl. headers)        | 146.8 KiB / 146.8 KiB   | 141.4 KiB / 141.4 KiB  |
| CSS external gzip -9                            | 29.2 KiB / 29.2 KiB     | 28.2 KiB / 28.2 KiB    |
| CSS inline raw                                  | 0 B / 0 B               | 0 B / 0 B              |
| CSS inline gzip -9                              | 0 B / 0 B               | 0 B / 0 B              |
| HTML raw                                        | 16.5 KiB / 16.5 KiB     | 36.7 KiB / 36.7 KiB    |
| HTML transferred (incl. headers)                | 16.8 KiB / 16.8 KiB     | 37.0 KiB / 37.0 KiB    |
| All transferred (incl. headers)                 | 1068.6 KiB / 1068.6 KiB | 290.0 KiB / 290.0 KiB  |

##### Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)

| Metric                                                                                              | ts (fake) median / p90 | go (fake) median / p90 |
| --------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------- |
| **First typeable (kept and acted on)**                                                              | n/a                    | 44 ms / 50 ms          |
| Gate: typing at first focus wiped                                                                   | 10/10 yes              | 0/10 yes               |
| Gate: typing at first focus ignored                                                                 | 0/10 yes               | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request)                                         | 1/10 yes               | 0/10 yes               |
| Translation requests sent by the page                                                               | 1 / 1                  | 1 / 1                  |
| First focus (burst first keystroke)                                                                 | 55 ms / 56 ms          | 39 ms / 50 ms          |
| Nav start to first main char, typing at first focus (dropped runs: after the retype)                | 1993 ms / 2010 ms      | 797 ms / 809 ms        |
| Input kept from (max(FCP, earliest kept keystroke), space probe)                                    | 90 ms / 93 ms          | 44 ms / 44 ms          |
| **First typeable (kept and acted on)** (repeat visit)                                               | 43 ms / 45 ms          | 24 ms / 27 ms          |
| Gate: typing at first focus wiped (repeat visit)                                                    | 0/10 yes               | 0/10 yes               |
| Gate: typing at first focus ignored (repeat visit)                                                  | 0/10 yes               | 0/10 yes               |
| Wiped and the remainder translated (extra upstream request) (repeat visit)                          | 0/10 yes               | 0/10 yes               |
| Translation requests sent by the page (repeat visit)                                                | 1 / 1                  | 1 / 1                  |
| First focus (burst first keystroke) (repeat visit)                                                  | 43 ms / 45 ms          | 24 ms / 26 ms          |
| Nav start to first main char, typing at first focus (dropped runs: after the retype) (repeat visit) | 813 ms / 829 ms        | 760 ms / 774 ms        |

##### Dropped-run penalty (secondary: retype model = settle, Clear, retype)

| Metric                                                               | ts (fake) median / p90 | go (fake) median / p90 |
| -------------------------------------------------------------------- | ---------------------- | ---------------------- |
| First typeable incl. the retype model                                | 1193 ms / 1199 ms      | 44 ms / 50 ms          |
| of which harness wait (settle point - input kept from), dropped runs | 1040 ms / 1044 ms      | n/a                    |
| Harness settle point, dropped runs                                   | 1130 ms / 1135 ms      | n/a                    |
| Clear + retype after settle, dropped runs                            | 62 ms / 70 ms          | n/a                    |
| First typeable incl. the retype model (repeat visit)                 | 43 ms / 45 ms          | 24 ms / 27 ms          |
| Harness settle point, dropped runs (repeat visit)                    | n/a                    | n/a                    |
| Clear + retype after settle, dropped runs (repeat visit)             | n/a                    | n/a                    |

##### Page load, repeat visit (same context, warm cache)

| Metric                                          | ts (fake) median / p90 | go (fake) median / p90 |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| TTFB (repeat)                                   | 3 ms / 4 ms            | 1 ms / 1 ms            |
| FCP (repeat)                                    | 20 ms / 24 ms          | 20 ms / 20 ms          |
| LCP (repeat)                                    | 20 ms / 24 ms          | 20 ms / 20 ms          |
| TBT (FCP to quiet) (repeat)                     | 0 ms / 0 ms            | 0 ms / 0 ms            |
| DOMContentLoaded (repeat)                       | 10 ms / 10 ms          | 19 ms / 20 ms          |
| load event (repeat)                             | 17 ms / 18 ms          | 19 ms / 20 ms          |
| CLS during load (repeat)                        | 0.000 / 0.000          | 0.000 / 0.000          |
| JS external transferred (repeat; 0 = cache hit) | 0 B / 0 B              | 0 B / 0 B              |
| All transferred (repeat)                        | 17.4 KiB / 17.4 KiB    | 37.3 KiB / 37.3 KiB    |

##### Translation on the settled page

| Metric                                                      | ts (fake) median / p90 | go (fake) median / p90 |
| ----------------------------------------------------------- | ---------------------- | ---------------------- |
| Last key to first main char                                 | 686 ms / 693 ms        | 695 ms / 698 ms        |
| Last key to Copy enabled                                    | 989 ms / 997 ms        | 914 ms / 917 ms        |
| Last key to done (stream ended + Copy + DOM quiet 500 ms)   | 4790 ms / 4812 ms      | 4924 ms / 4950 ms      |
| Translation requests sent by the page                       | 1 / 1                  | 1 / 1                  |
| Request end minus last DOM change (> 0: response held open) | -19 ms / -12 ms        | -13 ms / -2 ms         |
| Diagnostic: last key to Listen enabled (if the app has it)  | 4790 ms / 4812 ms      | 4924 ms / 4950 ms      |
| JS loaded through done, gzip -9                             | 285.3 KiB / 285.3 KiB  | 42.8 KiB / 42.8 KiB    |
| JS loaded through done, raw                                 | 907.4 KiB / 907.4 KiB  | 105.5 KiB / 105.5 KiB  |

##### Diagnostics: space probe during load

| Metric                                 | ts (fake) median / p90 | go (fake) median / p90 |
| -------------------------------------- | ---------------------- | ---------------------- |
| Earliest kept keystroke                | 90 ms / 93 ms          | 36 ms / 37 ms          |
| Earliest keystroke shown (may be lost) | 39 ms / 40 ms          | 36 ms / 37 ms          |
| Probe resolution (kept - last lost)    | 51 ms / 54 ms          | n/a                    |
| Whitespace input reached upstream      | 0/10 yes               | 0/10 yes               |

#### Server TTFB (Node client, no browser)

| Metric               | ts (fake) median / p90 | go (fake) median / p90 |
| -------------------- | ---------------------- | ---------------------- |
| Cold (first request) | 97 ms / 99 ms          | 1 ms / 1 ms            |
| Warm                 | 5 ms / 5 ms            | 0 ms / 1 ms            |

- ts (fake): Local process restarted per sample; cold = first GET / after TCP readiness, warm = the second GET. Node client, new connection each.
- go (fake): Local process restarted per sample; cold = first GET / after TCP readiness, warm = the second GET. Node client, new connection each.

#### Measured on

- ts (fake): 2026-11-04T08:33:37.598Z, commit 0968bde39fcc (dirty), build 13539ce6e011, harness dd731a369455, Apple M1 Max, 10 cores, 32 GiB, darwin 27.0.0 arm64, Playwright 1.64.1, webkit 27.2, chromium 156.0.8078.4
- go (fake): 2026-11-04T09:51:50.761Z, commit 56fd91bd31c8 (dirty), build a925555cfe52, harness dd731a369455, Apple M1 Max, 10 cores, 32 GiB, darwin 27.0.0 arm64, Playwright 1.64.1, webkit 27.2, chromium 156.0.8078.4
