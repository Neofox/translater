# Vercel Go streaming and cancellation spike (stage 0, Task 1)

Status: local checks PASS. Preview deployment: **pending** (controller/user creates the Vercel project, see below). The Task 1 gate (checks 1 and 2 on the real platform) is therefore NOT yet cleared.

## What was built

- `go/` module (`module neotranslate`, `go 1.27`), `go/mise.toml` (`go = "1.27"`), `go/vercel.json` (`{"framework": "go"}`). templ and tailwindcss entries are deliberately not in `mise.toml` yet: no tool is verified/used in this task, add them when Tasks needing them start.
- `go/main.go`: stdlib `net/http` spike server. `GET|POST /spike/stream?n&ms` (SSE, flush per event, records cancel time on `r.Context().Done()`), `GET /spike/stats`, `GET /spike/page`, `POST /spike/htmx`, `/static/` file server.
- `go/cmd/spikecheck/main.go`: checks 1, 2, 3, 4 (`-only cold`), 5.
- `go/cmd/spikecheck/htmx.mjs`: Playwright (chromium) driver for step 3b.
- `go/web/static/vendor/htmx.min.js` (htmx 4.0.1, from jsDelivr `htmx.org@4.0.1/dist/htmx.min.js`) and `hx-sse.min.js` (same release, `dist/ext/`).

## Finding that changes the contract for Tasks 10-11

htmx 4.0.1 core does **not** parse `text/event-stream`. SSE handling (unnamed message swap, named events as DOM events, release on stream end) lives in the **`hx-sse` extension** (`dist/ext/hx-sse.min.js`, 6.5 KB raw, 2.6 KB gzip) which must be loaded after htmx. With it, the plain `hx-post` form path works for non-`hx-sse:connect` elements (default `releaseOn: 'end'`, no reconnect). No alternative (`hx-sse:connect` with POST) was needed.

## Local results (`go run`/built binary on :3000, macOS, Go 1.27.3)

| Check | Result | Numbers |
|---|---|---|
| 1 incremental GET | PASS | 49/50 events >= 50 ms apart (need 40); first event 107 ms |
| 2 cancellation | PASS | `lastCancelAt - closeAt` = 0 ms (need <= 1500) |
| 3 reuse | PASS (informational) | 1 distinct instance in 5 calls, `served` 2 -> 2 (local, single process) |
| 4 cold TTFB | NOT RUN | needs the deployment and >= 15 min idle |
| 5 incremental POST | PASS | 49/50 events >= 50 ms apart; first event 100 ms |
| 3b (a) partials land incrementally, `hx-swap="none"` on form | PASS | A1 at +56 ms, B1 at +341 ms, gap 285 ms (~300) |
| 3b (b) named events | PASS | DOM events `nt-main-delta` and `nt-main-ready` fired; **the form (source element) is `event.target`**; they bubble, so a `document` listener also receives them. `event.detail = {data: "<raw JSON string>", id: ""}`: `data` is a string, parse it with `JSON.parse`. Spacing 301 ms |
| 3b (c1) `htmx.trigger(form,'htmx:abort')` | PASS | server `ctx.Done()` 4 ms after abort (need ~1000) |
| 3b (c2) second submit under `hx-sync="this:replace"` | PASS | server `ctx.Done()` 27 ms after second submit |
| 3b (d) gzip size vs 40 KB budget | PASS | htmx.min.js 37,448 B raw / 13,387 B gz; hx-sse.min.js 6,532 / 2,614; total 16,001 B gz (39% of budget) |
| page errors during 3b | PASS | none |

htmx version: **4.0.1** (latest 4.0.x on npm; 4.0.0 also exists).

## Caveats

- Local PASS says nothing about Vercel buffering/compression. Review focus item 5 is only settled by the preview run below.
- Check 3 locally cannot show multi-instance behaviour.
- Playwright chromium only; no WebKit run.

## Preview deployment: pending

Create/link a separate Vercel project with root directory `go/` (framework go), deploy a preview, then from the repo root:

```
cd go
go run ./cmd/spikecheck -url https://<preview-url>        # checks 1, 2, 3, 5
node cmd/spikecheck/htmx.mjs https://<preview-url>        # 3b (a)-(d)
# after >= 15 min with no traffic:
go run ./cmd/spikecheck -url https://<preview-url> -only cold   # check 4, target < 500 ms
```

If the preview is behind Vercel deployment protection, use a protection-bypass header/cookie or disable protection for the spike. If check 1 or 2 fails on the preview, stop and bring the fallback-host decision to the user (spec "Deployment").

Note: `main.go` serves static files from `web/static` relative to the working directory; verify on Vercel that those files are bundled (otherwise `htmx.mjs` fails to load htmx and the page-based checks fail even though streaming works). Add `includeFiles` in `vercel.json` if needed.

## Fix round 1 (review findings)

Changes:
1. Single-clock cancel measurement. `/spike/stats` now returns the server's `now`. Server-side `serverAgo = now - lastCancelAt` is pure server time; the client measures its own elapsed time since close. Estimated latency = clientElapsed - serverAgo; upper bound = client elapsed at first observation (includes poll interval and RTT). Pass criterion uses the upper bound (<=1500 ms spikecheck, <=1000 ms htmx.mjs). Server and client clocks are never subtracted.
2. `X-Instance` header on `/spike/stream` and `/spike/htmx`. Stats polls (up to 20, 100 ms apart) must come from that instance, else the check reports `INCONCLUSIVE` (never matched) rather than a false PASS/FAIL; matched-but-no-cancel is a real FAIL.
3. Negative control: `/spike/page?noext=1` loads htmx core only. Result: with no hx-sse extension, 0 named events fired and `#a`/`#b` stayed `A0`/`B0`, so the hx-sse extension IS required (it is what parses `text/event-stream`).
4. Minor: `x-vercel-protection-bypass` header from `VERCEL_AUTOMATION_BYPASS_SECRET` in both tools; guarded `delta && ready`; `browser.close()` in try/finally; check 4 also reports time-to-headers.

Commands (local, binary on :3000): `go run ./cmd/spikecheck -url http://localhost:3000` and `node cmd/spikecheck/htmx.mjs http://localhost:3000`.

Output (local): check 1 PASS 49/50 spaced; check 2 PASS estimated latency 1 ms, upper bound 105 ms; checks 3 and 5 PASS; htmx.mjs: (a) PASS gap 295 ms; (b) PASS events on `f`, detail `{data,id}`; (c1) PASS est 7 ms / upper 120 ms; (c2) PASS est 44 ms / upper 136 ms; (e) negative control PASS (extension required); (d) PASS 16,001 B gz total; no page errors. I did not run against the preview; rerun after the controller redeploys.
