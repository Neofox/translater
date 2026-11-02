// Measurement harness for the stage 2 go/no-go decision (spec "Measurement
// protocol"): page load (TTFB, FCP, LCP, TBT, JS/CSS bytes), first typeable,
// translation latency and keyboard-open layout movement, for the TS app or
// the Go app, measured identically.
//
//   npx tsx e2e/perf/measure.ts --app ts --fake --runs 10 --out results.json
//   npx tsx e2e/perf/measure.ts --app ts --live --url https://… \
//       --i-understand-this-is-billed --runs 10 --out results.json
//
// --fake builds the app's PRODUCTION build and serves it locally against the
// fake OpenAI server (go/cmd/fakeopenai): TS via e2e/perf/serve-ts.mjs, Go as
// a `go build` binary. Every translation must reach the fake exactly once.
// --live measures a deployed URL; each interaction run makes one billed
// OpenAI translation, so it refuses to start without the explicit flag.
//
// Hand-written orchestration: Playwright drives the browsers; Lighthouse
// cannot type, translate or simulate the keyboard, and Lighthouse throttling
// does not exist for WebKit either. See docs/superpowers/reports/*-baseline.md
// for what each metric means.
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { constants as zlibConstants, gzipSync } from 'node:zlib'
import { chromium, webkit } from 'playwright'
import type { Browser, BrowserContext, Page, Response } from 'playwright'
import { Fake, fixture, nonce } from '../tests/helpers'
import { PROFILES, profileDescription } from './profiles'
import type { Profile } from './profiles'
import { markdownTables } from './table'
import type { InteractRun, LoadRun, PerfFile, ProfileResult } from './table'

const ROOT = resolve(import.meta.dirname, '../..')
const GO_DIR = join(ROOT, 'go')
const BIN_DIR = join(tmpdir(), 'neotranslate-perf')
// Separate from the e2e suite's ports (fake 3901+, ts 3100+, go 3200+) so a
// running parity suite is never measured or disturbed.
const PORTS = { fake: 3951, ts: 3150, go: 3250 } as const
const FIXTURE = 'stream'
const SOURCE = '[data-testid="input-textarea"]'
const MAIN = '[data-testid="main-translation"]'
const COPY = '[data-testid="output-toolbar"] [data-testid="copy-button"]'
const LISTEN = '[data-testid="output-toolbar"] [data-testid="listen-button"]'
/** Keys typed one by one at the end of the source text (the rest is filled). */
const TYPED_TAIL = 6
const TYPE_DELAY_MS = 60

// ----- CLI ---------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    app: { type: 'string' },
    url: { type: 'string' },
    fake: { type: 'boolean', default: false },
    live: { type: 'boolean', default: false },
    'i-understand-this-is-billed': { type: 'boolean', default: false },
    runs: { type: 'string', default: '10' },
    out: { type: 'string' },
    profiles: { type: 'string' },
    'skip-build': { type: 'boolean', default: false },
  },
})

function usage(message: string): never {
  console.error(
    `${message}\n\nusage: npx tsx e2e/perf/measure.ts --app ts|go ` +
      '(--fake | --live --url <base> --i-understand-this-is-billed) ' +
      '[--runs 10] --out <results.json> [--profiles id,id] [--skip-build]',
  )
  process.exit(2)
}

const appArg = args.app
if (appArg !== 'ts' && appArg !== 'go') usage('--app must be ts or go')
const app: 'ts' | 'go' = appArg
if (args.fake === args.live) usage('choose exactly one of --fake or --live')
const mode = args.fake ? 'fake' : 'live'
const runs = Number(args.runs)
if (!Number.isInteger(runs) || runs < 1)
  usage('--runs must be a positive integer')
if (!args.out) usage('--out is required')
const outPath = resolve(args.out)
const profiles = args.profiles
  ? args.profiles.split(',').map((id) => {
      const p = PROFILES.find((q) => q.id === id)
      if (!p)
        usage(
          `unknown profile ${id}; known: ${PROFILES.map((q) => q.id).join(', ')}`,
        )
      return p
    })
  : PROFILES

if (mode === 'fake' && args.url)
  usage(
    '--url is not accepted with --fake: the harness starts its own production ' +
      'build against the fake upstream so no measurement can reach OpenAI.',
  )
if (mode === 'live') {
  if (!args.url) usage('--live needs --url <deployed base URL>')
  const billed = runs * profiles.length
  console.log(
    `--live plan: ${profiles.length} profile(s) x ${runs} run(s) = ${billed} ` +
      `billed OpenAI translation(s) against ${args.url} ` +
      '(one per interaction run; page loads, first-typeable and TTFB probes are free).',
  )
  if (!args['i-understand-this-is-billed']) {
    console.error(
      'Refusing: --live makes billed requests. Re-run with --i-understand-this-is-billed.',
    )
    process.exit(1)
  }
}

// ----- processes ---------------------------------------------------------------

const children = new Set<ChildProcess>()

function killAll(): void {
  for (const child of children) child.kill('SIGTERM')
}
process.on('exit', killAll)
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    killAll()
    process.exit(130)
  })

function start(
  command: string,
  argv: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
) {
  const child = spawn(command, argv, {
    cwd,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return { child, stderr: () => stderr }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((done) => child.once('exit', done))
  child.kill('SIGTERM')
  await exited
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      done(true)
    })
    socket.once('error', () => done(false))
  })
}

/** TCP readiness only: an HTTP probe would pay the app's cold first request,
 * which the cold-TTFB sample must measure. */
async function waitForPort(port: number, child: ChildProcess, what: string) {
  const deadline = Date.now() + 60_000
  while (!(await portOpen(port))) {
    if (child.exitCode !== null)
      throw new Error(`${what} exited (${child.exitCode}) before listening`)
    if (Date.now() > deadline)
      throw new Error(`${what} did not listen on ${port} within 60s`)
    await sleep(10)
  }
}

function sleep(ms: number) {
  return new Promise((done) => setTimeout(done, ms))
}

/** Time to the response headers of one GET (Node client, new connection). */
function timedGet(
  url: string,
): Promise<{ ttfb: number; body: string; status: number }> {
  return new Promise((done, fail) => {
    const t0 = performance.now()
    const get = url.startsWith('https:') ? httpsRequest : httpRequest
    const req = get(
      url,
      { headers: { 'accept-language': 'en-US', connection: 'close' } },
      (res) => {
        const ttfb = performance.now() - t0
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (d: string) => (body += d))
        res.on('end', () => done({ ttfb, body, status: res.statusCode ?? 0 }))
      },
    )
    req.on('error', fail)
    req.end()
  })
}

function assertTranslatorPage(body: string, url: string): void {
  if (!body.includes('data-testid="input-textarea"'))
    throw new Error(
      `${app} app at ${url} does not serve the translator page ` +
        '(no [data-testid="input-textarea"]); nothing to measure yet.',
    )
}

// ----- fake mode servers -----------------------------------------------------------

type AppServer = { url: string; start: () => ReturnType<typeof start> }

function appEnv(port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    // Same isolation env as e2e/playwright.config.ts: the fake upstream and a
    // dummy key, telemetry off.
    OPENAI_BASE_URL: `http://127.0.0.1:${PORTS.fake}/v1`,
    OPENAI_API_KEY: 'test',
    LANGFUSE_PUBLIC_KEY: '',
    LANGFUSE_SECRET_KEY: '',
    AI_GATEWAY_API_KEY: '',
  }
}

async function prepareFake(): Promise<{ fake: Fake; server: AppServer }> {
  for (const port of [PORTS.fake, PORTS[app]])
    if (await portOpen(port))
      throw new Error(
        `port ${port} is already in use; stop that server first (it could hold a real key)`,
      )
  mkdirSync(BIN_DIR, { recursive: true })
  const fakeBin = join(BIN_DIR, 'fakeopenai')
  console.log('building the fake OpenAI server…')
  execFileSync('go', ['build', '-o', fakeBin, './cmd/fakeopenai'], {
    cwd: GO_DIR,
    stdio: 'inherit',
  })
  let server: AppServer
  const port = PORTS[app]
  const url = `http://127.0.0.1:${port}`
  if (app === 'ts') {
    if (!args['skip-build']) {
      console.log('building the TS app (npm run build)…')
      execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
    }
    server = {
      url,
      start: () =>
        start(
          process.execPath,
          [join(ROOT, 'e2e/perf/serve-ts.mjs')],
          appEnv(port),
          ROOT,
        ),
    }
  } else {
    const appBin = join(BIN_DIR, 'app-go')
    console.log('building the Go app (go build)…')
    execFileSync('go', ['build', '-o', appBin, '.'], {
      cwd: GO_DIR,
      stdio: 'inherit',
    })
    server = { url, start: () => start(appBin, [], appEnv(port), GO_DIR) }
  }
  const fakeProc = start(
    fakeBin,
    [
      '-addr',
      `127.0.0.1:${PORTS.fake}`,
      '-fixtures',
      join(ROOT, 'e2e/fixtures/results'),
    ],
    process.env,
    GO_DIR,
  )
  await waitForPort(PORTS.fake, fakeProc.child, 'fake OpenAI server')
  const fake = new Fake(`http://127.0.0.1:${PORTS.fake}`)
  await fake.reset()
  return { fake, server }
}

/** Cold = first request to a freshly started process; warm = the next one.
 * One process restart per sample. */
async function serverTtfbFake(server: AppServer, samples: number) {
  const coldTtfb: number[] = []
  const warmTtfb: number[] = []
  for (let i = 0; i < samples; i++) {
    const proc = server.start()
    const port = Number(new URL(server.url).port)
    try {
      await waitForPort(port, proc.child, `${app} app`)
      const cold = await timedGet(`${server.url}/`)
      if (i === 0) assertTranslatorPage(cold.body, server.url)
      const warm = await timedGet(`${server.url}/`)
      coldTtfb.push(cold.ttfb)
      warmTtfb.push(warm.ttfb)
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${proc.stderr()}`,
      )
    } finally {
      await stop(proc.child)
    }
  }
  return {
    note:
      'Local process restarted per sample; cold = first GET / after TCP ' +
      'readiness, warm = the second GET. Node client, new connection each.',
    coldTtfb,
    warmTtfb,
  }
}

/** Production instances cannot be forced cold: the first request of the
 * session may or may not hit one. */
async function serverTtfbLive(url: string, samples: number) {
  const first = await timedGet(`${url}/`)
  assertTranslatorPage(first.body, url)
  const warmTtfb: number[] = []
  for (let i = 0; i < samples; i++) {
    await sleep(200)
    warmTtfb.push((await timedGet(`${url}/`)).ttfb)
  }
  return {
    note:
      'Deployed URL: "cold" is only the first request of this session (a ' +
      'cold instance is likely but not guaranteed); warm = later requests ' +
      '200 ms apart. Node client from this machine, includes network RTT.',
    coldTtfb: [first.ttfb],
    warmTtfb,
  }
}

// ----- browser helpers -------------------------------------------------------------

async function newPage(
  browser: Browser,
  profile: Profile,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ...profile.context,
    locale: 'en-US',
  })
  // tsx (esbuild keepNames) wraps named functions in `__name(...)`; the
  // functions this file serializes into the page need that helper there.
  await context.addInitScript({ content: 'globalThis.__name = (fn) => fn' })
  const page = await context.newPage()
  if (profile.browser === 'chromium') {
    const cdp = await context.newCDPSession(page)
    if (profile.cpuSlowdown > 1)
      await cdp.send('Emulation.setCPUThrottlingRate', {
        rate: profile.cpuSlowdown,
      })
    if (profile.network) {
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: profile.network.latencyMs,
        downloadThroughput: (profile.network.downloadKbps * 1024) / 8,
        uploadThroughput: (profile.network.uploadKbps * 1024) / 8,
      })
    }
  }
  return { context, page }
}

type PerfWindow = Window & {
  __perf: {
    fcp: number | null
    lcp: number | null
    cls: number
    longtasks: Array<[number, number]>
  }
}

/** Installed before any page script so buffered and non-buffered entries
 * (longtask has no reliable buffer) are all seen. */
function installPerfObservers() {
  const w = window as unknown as PerfWindow
  const perf: PerfWindow['__perf'] = {
    fcp: null,
    lcp: null,
    cls: 0,
    longtasks: [],
  }
  w.__perf = perf
  const types = PerformanceObserver.supportedEntryTypes
  const observe = (
    type: string,
    onEntry: (entry: PerformanceEntry) => void,
  ) => {
    if (!types.includes(type)) return
    new PerformanceObserver((list) =>
      list.getEntries().forEach(onEntry),
    ).observe({ type, buffered: true })
  }
  observe('paint', (e) => {
    if (e.name === 'first-contentful-paint') perf.fcp = e.startTime
  })
  observe('largest-contentful-paint', (e) => {
    perf.lcp = e.startTime
  })
  observe('longtask', (e) => {
    perf.longtasks.push([e.startTime, e.duration])
  })
  observe('layout-shift', (e) => {
    perf.cls += (e as PerformanceEntry & { value: number }).value
  })
}

function gzipSize(body: Buffer): number {
  return gzipSync(body, { level: zlibConstants.Z_BEST_COMPRESSION }).length
}

async function loadRun(
  browser: Browser,
  profile: Profile,
  url: string,
): Promise<LoadRun> {
  const { context, page } = await newPage(browser, profile)
  try {
    const responses: Response[] = []
    page.on('response', (r) => responses.push(r))
    await page.addInitScript(installPerfObservers)
    await page.goto(url, { waitUntil: 'load', timeout: 120_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
    // Quiet window for late long tasks and LCP candidates.
    await page.waitForTimeout(1000)
    const perf = await page.evaluate(() => {
      const p = (window as unknown as PerfWindow).__perf
      const nav = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined
      // Lighthouse-style TBT: the part of each long task after FCP beyond 50 ms.
      const tbt =
        p.fcp === null ||
        !PerformanceObserver.supportedEntryTypes.includes('longtask')
          ? null
          : p.longtasks.reduce((sum, [begin, duration]) => {
              const from = Math.max(begin, p.fcp!)
              return sum + Math.max(0, begin + duration - from - 50)
            }, 0)
      return {
        ttfb: nav ? nav.responseStart : null,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
        load: nav ? nav.loadEventEnd : null,
        fcp: p.fcp,
        lcp: p.lcp,
        tbt,
        loadCls: PerformanceObserver.supportedEntryTypes.includes(
          'layout-shift',
        )
          ? p.cls
          : null,
      }
    })
    const resources: LoadRun['resources'] = []
    let totalTransferred = 0
    for (const r of responses) {
      const sizes = await r
        .request()
        .sizes()
        .catch(() => null)
      const transferred = sizes
        ? sizes.responseBodySize + sizes.responseHeadersSize
        : null
      totalTransferred += transferred ?? 0
      const type = r.request().resourceType()
      if (!['script', 'stylesheet', 'document'].includes(type)) continue
      const body = await r.body().catch(() => null)
      resources.push({
        url: r.url(),
        type,
        status: r.status(),
        encoding: (await r.headerValue('content-encoding')) ?? null,
        raw: body?.length ?? 0,
        transferred: sizes ? sizes.responseBodySize : null,
        gzip: body ? gzipSize(body) : null,
      })
    }
    const sum = (type: string, key: 'raw' | 'transferred' | 'gzip') =>
      resources
        .filter((x) => x.type === type && x.status < 400)
        .reduce((total, x) => total + (x[key] ?? 0), 0)
    return {
      ...perf,
      jsRaw: sum('script', 'raw'),
      jsTransferred: sum('script', 'transferred'),
      jsGzip: sum('script', 'gzip'),
      cssRaw: sum('stylesheet', 'raw'),
      cssTransferred: sum('stylesheet', 'transferred'),
      cssGzip: sum('stylesheet', 'gzip'),
      htmlRaw: sum('document', 'raw'),
      htmlTransferred: sum('document', 'transferred'),
      totalTransferred,
      resources,
    }
  } finally {
    await context.close()
  }
}

type InteractWindow = Window & {
  __typeable: number[]
  __tr: {
    last: number
    first: number | null
    copy: number | null
    done: number | null
    baseline: string
  }
  __keyboard?: {
    set: (height: number | null, offsetTop: number | null) => void
  }
}

/** Records the timestamp of every input event on the source textarea, from
 * document start (before any app script, so pre-hydration input counts). */
function installTypeableRecorder(selector: string) {
  const w = window as unknown as InteractWindow
  w.__typeable = []
  document.addEventListener(
    'input',
    (e) => {
      if (e.target instanceof Element && e.target.matches(selector))
        w.__typeable.push(e.timeStamp)
    },
    true,
  )
}

/** Replaces window.visualViewport with an EventTarget that mirrors the real
 * one until the harness overrides height/offsetTop, the technique of
 * tests/browser/mobile.browser.tsx (stubbed visualViewport, shrunk step by
 * step with resize events) applied to a real page. */
function installFakeVisualViewport() {
  const real = window.visualViewport
  if (!real) return
  const fake = new EventTarget()
  let height: number | null = null
  let offsetTop: number | null = null
  for (const key of [
    'width',
    'offsetLeft',
    'pageLeft',
    'pageTop',
    'scale',
  ] as const)
    Object.defineProperty(fake, key, { get: () => real[key] })
  Object.defineProperty(fake, 'height', { get: () => height ?? real.height })
  Object.defineProperty(fake, 'offsetTop', {
    get: () => offsetTop ?? real.offsetTop,
  })
  real.addEventListener('resize', () => fake.dispatchEvent(new Event('resize')))
  real.addEventListener('scroll', () => fake.dispatchEvent(new Event('scroll')))
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    get: () => fake,
  })
  ;(window as unknown as InteractWindow).__keyboard = {
    set(h, top) {
      height = h
      offsetTop = top
      fake.dispatchEvent(new Event('resize'))
      fake.dispatchEvent(new Event('scroll'))
    },
  }
}

function focusSource(selector: string): boolean {
  const el = document.querySelector<HTMLTextAreaElement>(selector)
  if (!el) return false
  if (document.activeElement !== el) el.focus({ preventScroll: true })
  return document.activeElement === el
}

/** First typeable: during the load, type a space whenever the textarea can
 * take focus (spaces never start a translation: whitespace-only input is
 * ignored). A keystroke counts only if its character is still there once the
 * page has settled; hydration that resets the field discards the earlier
 * ones. The result is the in-page timestamp of the earliest surviving
 * keystroke's input event. */
async function measureFirstTypeable(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'commit', timeout: 120_000 })
  const state = { idle: false }
  const idlePromise = page
    .waitForLoadState('networkidle', { timeout: 120_000 })
    .then(() => (state.idle = true))
  let afterIdle = 0
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const focused = await page.evaluate(focusSource, SOURCE).catch(() => false)
    if (focused) await page.keyboard.type(' ')
    if (state.idle && ++afterIdle >= 5) break
    await page.waitForTimeout(state.idle ? 100 : focused ? 25 : 10)
  }
  await idlePromise
  await page.waitForTimeout(500)
  const { events, value } = await page.evaluate((selector) => {
    const w = window as unknown as InteractWindow
    return {
      events: w.__typeable,
      value: document.querySelector<HTMLTextAreaElement>(selector)?.value ?? '',
    }
  }, SOURCE)
  const survivors = value.length
  const firstInput = events[0] ?? null
  if (value.trim() !== '' || survivors === 0 || survivors > events.length)
    return { firstTypeable: null, firstInput, attempts: events.length }
  return {
    firstTypeable: events[events.length - survivors]!,
    firstInput,
    attempts: events.length,
  }
}

function installTranslationObserver(s: {
  main: string
  copy: string
  listen: string
  source: string
}) {
  const w = window as unknown as InteractWindow
  const text = () => document.querySelector(s.main)?.textContent.trim() ?? ''
  const tr: InteractWindow['__tr'] = {
    last: 0,
    first: null,
    copy: null,
    done: null,
    baseline: text(),
  }
  w.__tr = tr
  document.addEventListener(
    'input',
    (e) => {
      if (e.target instanceof Element && e.target.matches(s.source))
        tr.last = e.timeStamp
    },
    true,
  )
  const enabled = (selector: string) => {
    const el = document.querySelector<HTMLButtonElement>(selector)
    return Boolean(el && !el.disabled)
  }
  const check = () => {
    if (tr.last === 0) return
    const now = performance.now()
    const main = text()
    if (tr.first === null && main !== '' && main !== tr.baseline) tr.first = now
    if (tr.copy === null && enabled(s.copy)) tr.copy = now
    if (tr.done === null && enabled(s.listen)) tr.done = now
  }
  new MutationObserver(check).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled'],
  })
}

async function measureTranslation(page: Page, text: string, fake: Fake | null) {
  if (
    await page.evaluate(
      (s) =>
        Boolean(
          document.querySelector<HTMLButtonElement>(s)?.disabled === false,
        ),
      COPY,
    )
  )
    throw new Error('Copy is enabled before the translation run')
  await page.evaluate(installTranslationObserver, {
    main: MAIN,
    copy: COPY,
    listen: LISTEN,
    source: SOURCE,
  })
  const before = fake ? await fake.requests() : null
  const source = page.locator(SOURCE)
  await source.fill(text.slice(0, -TYPED_TAIL))
  await page.keyboard.type(text.slice(-TYPED_TAIL), { delay: TYPE_DELAY_MS })
  const typed = await source.inputValue()
  if (typed !== text)
    throw new Error(
      `source holds ${JSON.stringify(typed)}, expected the typed text`,
    )
  await page.waitForFunction(
    () => (window as unknown as InteractWindow).__tr.done !== null,
    null,
    {
      timeout: 60_000,
      polling: 50,
    },
  )
  const tr = await page.evaluate(
    () => (window as unknown as InteractWindow).__tr,
  )
  let upstreamRequests: number | null = null
  if (fake) {
    upstreamRequests = (await fake.requests()) - before!
    if (upstreamRequests === 0)
      throw new IsolationError(
        'the translation completed without reaching the fake upstream',
      )
    const bodies = await fake.bodies()
    if (!bodies.some((b) => JSON.stringify(b).includes(text.split(' ')[1]!)))
      throw new IsolationError('the fake upstream never saw this run’s nonce')
    if (upstreamRequests !== 1)
      throw new Error(
        `expected exactly one upstream request, saw ${upstreamRequests}`,
      )
  }
  const since = (t: number | null) => (t === null ? null : t - tr.last)
  return {
    keyToFirstChar: since(tr.first),
    keyToCopy: since(tr.copy),
    keyToDone: since(tr.done),
    upstreamRequests,
  }
}

/** Blur (keyboard closed), then focus the source and shrink the visual
 * viewport to 60% in 50 px steps, 50 ms apart (roughly a software keyboard's
 * slide-in), with resize + scroll events like a real one. */
async function measureKeyboard(page: Page) {
  return page.evaluate(
    async ({ main, source }) => {
      const w = window as unknown as InteractWindow
      const frame = () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        )
      const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
      const top = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect().top ?? null
      const input = document.querySelector<HTMLTextAreaElement>(source)!
      if (!w.__keyboard) throw new Error('fake visualViewport missing')
      input.blur()
      await wait(400)
      const mainBefore = top(main)
      const sourceBefore = top(source)
      const clsSupported =
        PerformanceObserver.supportedEntryTypes.includes('layout-shift')
      let cls = 0
      const observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          cls += (e as PerformanceEntry & { value: number }).value
      })
      if (clsSupported) observer.observe({ type: 'layout-shift' })
      input.focus({ preventScroll: true })
      const full = window.innerHeight
      const visible = Math.round(full * 0.6)
      for (let h = full - 50; h > visible; h -= 50) {
        w.__keyboard.set(h, 0)
        await frame()
        await wait(50)
      }
      w.__keyboard.set(visible, 0)
      await wait(600)
      await frame()
      observer.disconnect()
      const mainAfter = top(main)
      const sourceAfter = top(source)
      const dy = (a: number | null, b: number | null) =>
        a === null || b === null ? null : Math.abs(b - a)
      return {
        keyboardCls: clsSupported ? cls : null,
        keyboardMainDy: dy(mainBefore, mainAfter),
        keyboardSourceDy: dy(sourceBefore, sourceAfter),
      }
    },
    { main: MAIN, source: SOURCE },
  )
}

class IsolationError extends Error {}

async function interactRun(
  browser: Browser,
  profile: Profile,
  url: string,
  fake: Fake | null,
): Promise<InteractRun> {
  const { context, page } = await newPage(browser, profile)
  try {
    await page.addInitScript(installTypeableRecorder, SOURCE)
    if (profile.keyboard) await page.addInitScript(installFakeVisualViewport)
    const typeable = await measureFirstTypeable(page, url)
    const text = `${fake ? `${fixture(FIXTURE).match} ` : ''}${nonce()} How are you doing today, my friend?`
    const translation = await measureTranslation(page, text, fake)
    const keyboard = profile.keyboard
      ? await measureKeyboard(page)
      : { keyboardCls: null, keyboardMainDy: null, keyboardSourceDy: null }
    return {
      firstTypeable: typeable.firstTypeable,
      firstInput: typeable.firstInput,
      typeableAttempts: typeable.attempts,
      ...translation,
      ...keyboard,
    }
  } finally {
    await context.close()
  }
}

async function attempt<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof IsolationError) throw error
    const message =
      error instanceof Error ? error.message.split('\n')[0]! : String(error)
    console.error(`  ${label} failed: ${message}`)
    return { error: `${label}: ${message}` }
  }
}

async function measureProfile(
  profile: Profile,
  url: string,
  fake: Fake | null,
  warmUp: boolean,
): Promise<ProfileResult> {
  const browser = await (
    profile.browser === 'webkit' ? webkit : chromium
  ).launch()
  try {
    const supportedEntryTypes = await (async () => {
      const page = await browser.newPage()
      const types = await page.evaluate(() => [
        ...PerformanceObserver.supportedEntryTypes,
      ])
      await page.close()
      return types
    })()
    if (warmUp) {
      // Discarded: lets the freshly started server load its lazy chunks so
      // page-load runs measure a warm instance (cold TTFB is measured apart).
      await loadRun(browser, profile, url)
      if (fake) await interactRun(browser, profile, url, fake)
    }
    const result: ProfileResult = {
      profile: profileDescription(profile),
      browserVersion: browser.version(),
      supportedEntryTypes,
      load: [],
      interact: [],
    }
    for (let i = 0; i < runs; i++) {
      result.load.push(
        await attempt(`load ${i + 1}`, () => loadRun(browser, profile, url)),
      )
      result.interact.push(
        await attempt(`interact ${i + 1}`, () =>
          interactRun(browser, profile, url, fake),
        ),
      )
      process.stdout.write(`  ${profile.id}: run ${i + 1}/${runs}\n`)
    }
    return result
  } finally {
    await browser.close()
  }
}

function git(...argv: string[]): string {
  return execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8' }).trim()
}

async function measure(): Promise<void> {
  let url: string
  let fake: Fake | null = null
  let server: PerfFile['server']
  let appProc: ReturnType<typeof start> | null = null
  if (mode === 'fake') {
    const prepared = await prepareFake()
    fake = prepared.fake
    url = prepared.server.url
    console.log(`server TTFB: ${runs} cold restarts…`)
    server = await serverTtfbFake(prepared.server, runs)
    appProc = prepared.server.start()
    await waitForPort(Number(new URL(url).port), appProc.child, `${app} app`)
  } else {
    url = args.url!.replace(/\/$/, '')
    server = await serverTtfbLive(url, runs)
  }

  const results: ProfileResult[] = []
  for (const [index, profile] of profiles.entries()) {
    console.log(`profile ${profile.id}…`)
    results.push(
      await measureProfile(profile, url, fake, index === 0 && mode === 'fake'),
    )
  }

  const file: PerfFile = {
    meta: {
      app,
      mode,
      url,
      date: new Date().toISOString(),
      commit: git('rev-parse', 'HEAD'),
      dirty: git('status', '--porcelain') !== '',
      runs,
      node: process.version,
      playwright: (
        JSON.parse(
          readFileSync(
            join(ROOT, 'node_modules/playwright/package.json'),
            'utf8',
          ),
        ) as { version: string }
      ).version,
      text: `${mode === 'fake' ? `${fixture(FIXTURE).match} ` : ''}<nonce> How are you doing today, my friend?`,
      debounce:
        'Included in every "last key" timing: the text ends in "?", so both apps use the 400 ms sentence-final debounce.',
      compression:
        mode === 'fake'
          ? 'Local servers send everything uncompressed (one policy for every app); compare the computed gzip sizes.'
          : 'As served by the deployment (see each resource’s encoding).',
      notes: [
        'TTFB/FCP/LCP/DOMContentLoaded/load are ms from navigation start (Navigation and Paint Timing, PerformanceObserver).',
        'Chromium applies CDP network throttling after the Navigation Timing responseStart point, so throttled-profile TTFB excludes the emulated 562.5 ms latency (it is server + loopback time); FCP, LCP and later metrics include the throttled delivery.',
        'First typeable = earliest keystroke still in the field once the page settled (spaces typed during load); first keystroke shown = earliest input event at all.',
        'Pages load the production font CSS/subsets from their CDN over the real network, as in production.',
        'TBT = sum over long tasks of the part after FCP beyond 50 ms, until 1 s after network idle (Chromium only: WebKit has no longtask entries).',
        'LCP and CLS need largest-contentful-paint / layout-shift entries; supportedEntryTypes per profile says which engine has them.',
        '"First main char" is the DOM mutation that first shows main text (MutationObserver, performance.now()), not a paint.',
        'Transferred = response body bytes on the wire (+ headers in "All transferred"); raw = decoded; gzip = gzip -9 of the decoded body.',
        'Every run uses a fresh browser context (empty cache, no cookies).',
      ],
    },
    server,
    profiles: results,
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`)
  console.log(`\nwrote ${outPath}\n`)
  console.log(markdownTables([file]))
  if (appProc) await stop(appProc.child)
}

await measure().then(
  () => {
    killAll()
    process.exit(0)
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    killAll()
    process.exit(1)
  },
)
