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
const stats = async () => (await fetch(`${base}/spike/stats`, { cache: 'no-store' })).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

async function fresh() {
  await page.goto(`${base}/spike/page`)
  await page.waitForFunction(() => window.htmx)
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
report('a partials incremental with hx-swap=none', aAt && bAt && gap >= 200 && gap <= 500,
  `A1 at +${aAt - t0}ms, B1 at +${bAt - t0}ms, gap=${gap}ms (expect ~300)`)
const delta = events.find((e) => e.name === 'nt-main-delta')
const ready = events.find((e) => e.name === 'nt-main-ready')
report('b named events dispatched', !!delta && !!ready, `delta.target=${delta?.target} ready.target=${ready?.target}`)
report('b event.detail exposes data', delta?.detail?.data === '{"text":"안녕"}' && ready?.detail?.data === '{"main":"안녕하세요"}',
  `delta.detail=${JSON.stringify(delta?.detail)} ready.detail=${JSON.stringify(ready?.detail)}`)
report('b events at +300ms spacing', ready.t - delta.t >= 200, `ready-delta=${ready.t - delta.t}ms`)

// (c1) htmx:abort
await fresh()
let before = await stats()
await page.click('#go')
await sleep(700) // partials A1/B1 have landed, stream still open
const abortAt = Date.now()
await page.evaluate(() => htmx.trigger(document.getElementById('f'), 'htmx:abort'))
await sleep(1200)
let after = await stats()
let d = after.lastCancelAt - abortAt
report('c1 htmx:abort closes fetch', after.lastCancelAt !== before.lastCancelAt && d >= -50 && d <= 1000,
  `server ctx.Done ${d}ms after abort (need <=1000)`)

// (c2) second submit under hx-sync="this:replace"
await fresh()
before = await stats()
await page.click('#go')
await sleep(700)
const secondAt = Date.now()
await page.click('#go')
await sleep(1200)
after = await stats()
d = after.lastCancelAt - secondAt
report('c2 hx-sync this:replace closes first fetch', after.lastCancelAt !== before.lastCancelAt && d >= -50 && d <= 1000,
  `server ctx.Done ${d}ms after second submit (need <=1000)`)
await page.evaluate(() => htmx.trigger(document.getElementById('f'), 'htmx:abort'))
await sleep(300)

// (d) size
const dir = join(dirname(fileURLToPath(import.meta.url)), '../../web/static/vendor')
const sizes = ['htmx.min.js', 'hx-sse.min.js'].map((f) => {
  const b = readFileSync(join(dir, f))
  return [f, b.length, gzipSync(b, { level: 9 }).length]
})
const gz = sizes.reduce((s, x) => s + x[2], 0)
report('d gzip size vs 40KB budget', gz < 40 * 1024, sizes.map(([f, raw, g]) => `${f} raw=${raw} gz=${g}`).join('; ') + ` total gz=${gz}`)

report('page errors', errors.length === 0, errors.join(' | ') || 'none')
await browser.close()
process.exit(failed ? 1 : 0)
