// htmx 4 protocol spike: node go/cmd/spikecheck/htmx.mjs <baseUrl>
// Verifies (a) incremental <hx-partial> swaps with hx-swap="none" on the form,
// (b) named SSE events dispatch DOM events with event.detail data and which
// element receives them, (c) htmx:abort and hx-sync="this:replace" cancel the
// fetch (server sees ctx.Done()), (d) gzip size of htmx + hx-sse.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')
let failed = false
const report = (name, ok, detail) => {
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : {}
const stats = async () => (await fetch(`${base}/spike/stats`, { cache: 'no-store', headers })).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
try {
const page = await browser.newPage()
if (bypass) await page.setExtraHTTPHeaders(headers)
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
let streamInstance = null
page.on('response', (r) => {
  if (r.url().endsWith('/spike/htmx')) streamInstance = r.headers()['x-instance'] ?? null
})

async function fresh(query = '') {
  await page.goto(`${base}/spike/page${query}`)
  await page.waitForFunction(() => window.htmx)
}

// Single-clock cancel measurement (see spikecheck/main.go cancellation): the
// stats poll must come from the instance that served the stream; latency is
// derived from server-side (now - lastCancelAt) and client-side elapsed time.
async function cancelCheck(name, closeFn) {
  const closedAt = performance.now()
  await closeFn()
  let last = null
  for (let i = 1; i <= 20; i++) {
    await sleep(100)
    const elapsed = performance.now() - closedAt
    let s
    try { s = await stats() } catch { continue }
    last = s
    if (!streamInstance || s.instance !== streamInstance) continue
    const serverAgo = s.now - s.lastCancelAt
    if (s.lastCancelAt === 0 || serverAgo > elapsed + 100) continue
    const upper = performance.now() - closedAt
    report(name, upper <= 1000, `instance=${streamInstance} try=${i} estimated latency=${Math.round(upper - serverAgo)}ms upper bound=${Math.round(upper)}ms (need <=1000)`)
    return
  }
  const matched = last && streamInstance && last.instance === streamInstance
  report(`${name}${matched ? '' : ' INCONCLUSIVE'}`, false,
    matched ? 'stream instance reached but lastCancelAt never updated' : `stats never came from stream instance ${streamInstance} (last ${last?.instance})`)
}

// (a) + (b)
await fresh()
const t0 = Date.now()
await page.click('#go')
await page.waitForFunction(() => window.spikeEvents.some((e) => e.name === 'nt-main-ready'), null, { timeout: 5000 })
const { swaps, events, form } = await page.evaluate(() => ({
  swaps: window.spikeSwaps,
  events: window.spikeEvents,
  form: document.getElementById('f').outerHTML.slice(0, 40),
}))
const aAt = swaps.find((s) => s.a === 'A1')?.t
const bAt = swaps.find((s) => s.b === 'B1')?.t
const gap = bAt - aAt
report('a partials incremental with hx-swap=none', !!(aAt && bAt) && gap >= 200 && gap <= 500,
  `A1 at +${aAt - t0}ms, B1 at +${bAt - t0}ms, gap=${gap}ms (expect ~300)`)
const delta = events.find((e) => e.name === 'nt-main-delta')
const ready = events.find((e) => e.name === 'nt-main-ready')
report('b named events dispatched', !!delta && !!ready, `delta.target=${delta?.target} ready.target=${ready?.target}`)
report('b event.detail exposes data', delta?.detail?.data === '{"text":"안녕"}' && ready?.detail?.data === '{"main":"안녕하세요"}',
  `delta.detail=${JSON.stringify(delta?.detail)} ready.detail=${JSON.stringify(ready?.detail)}`)
report('b events at +300ms spacing', !!(delta && ready) && ready.t - delta.t >= 200, delta && ready ? `ready-delta=${ready.t - delta.t}ms` : 'missing event')

// (c1) htmx:abort
await fresh()
await page.click('#go')
await sleep(700) // partials A1/B1 have landed, stream still open
await cancelCheck('c1 htmx:abort closes fetch', () => page.evaluate(() => htmx.trigger(document.getElementById('f'), 'htmx:abort')))

// (c2) second submit under hx-sync="this:replace"
await fresh()
await page.click('#go')
await sleep(700)
await cancelCheck('c2 hx-sync this:replace closes first fetch', () => page.click('#go'))
await page.evaluate(() => htmx.trigger(document.getElementById('f'), 'htmx:abort'))
await sleep(300)

// (e) negative control: without the hx-sse extension, are partials/named events handled?
await fresh('?noext=1')
const hasExt = await page.evaluate(() => !!document.querySelector('script[src*="hx-sse"]'))
await page.click('#go')
await sleep(1500)
const neg = await page.evaluate(() => ({ events: window.spikeEvents.length, a: document.getElementById('a').textContent, b: document.getElementById('b').textContent }))
await page.evaluate(() => htmx.trigger(document.getElementById('f'), 'htmx:abort'))
report('e negative control: core only (no hx-sse) does NOT process the stream', !hasExt && neg.events === 0 && neg.a === 'A0' && neg.b === 'B0',
  `extension loaded=${hasExt} named events=${neg.events} #a="${neg.a}" #b="${neg.b}" (extension required if events=0 and A0/B0 unchanged)`)

// (d) size
const dir = join(dirname(fileURLToPath(import.meta.url)), '../../web/static/vendor')
const sizes = ['htmx.min.js', 'hx-sse.min.js'].map((f) => {
  const b = readFileSync(join(dir, f))
  return [f, b.length, gzipSync(b, { level: 9 }).length]
})
const gz = sizes.reduce((s, x) => s + x[2], 0)
report('d gzip size vs 40KB budget', gz < 40 * 1024, sizes.map(([f, raw, g]) => `${f} raw=${raw} gz=${g}`).join('; ') + ` total gz=${gz}`)

report('page errors', errors.length === 0, errors.join(' | ') || 'none')
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
