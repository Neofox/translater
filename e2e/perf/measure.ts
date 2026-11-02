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
// a `go build` binary. Every translation must reach the fake.
// --live measures a deployed URL; translations are billed, so it refuses to
// start without the explicit flag.
//
// Hand-written orchestration: Playwright drives the browsers; Lighthouse
// cannot type, translate or simulate the keyboard, and Lighthouse throttling
// does not exist for WebKit either. See docs/superpowers/reports/*-baseline.md
// for what each metric means.
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect } from 'node:net'
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { constants as zlibConstants, gzipSync } from 'node:zlib'
import { parse } from 'parse5'
import { chromium, webkit } from 'playwright'
import type {
  Browser,
  BrowserContext,
  LaunchOptions,
  Page,
  Response,
} from 'playwright'
import { Fake, fixture, nonce, userText } from '../tests/helpers'
import {
  focusSource,
  installFakeVisualViewport,
  installInputTracker,
  installPerfObservers,
  layoutSnapshot,
  readPerf,
  startShiftObserver,
  stopShiftObserver,
} from './page-scripts'
import type { PageGlobals, Selectors } from './page-scripts'
import { PROFILES, bytesPerSecond, profileDescription } from './profiles'
import type { Profile } from './profiles'
import { markdownTables } from './table'
import type {
  InteractRun,
  KeyboardRun,
  LoadRun,
  PerfFile,
  ProbeRun,
  ProfileResult,
  Resource,
  TypeableRun,
} from './table'

const ROOT = resolve(import.meta.dirname, '../..')
const GO_DIR = join(ROOT, 'go')
const BIN_DIR = join(tmpdir(), 'neotranslate-perf')
// Separate from the e2e suite's ports (fake 3901+, ts 3100+, go 3200+) so a
// running parity suite is never measured or disturbed.
const PORTS = { fake: 3951, ts: 3150, go: 3250, proxy: 3960 } as const
/** Nothing listens here: in --fake every non-loopback request (CDN fonts,
 * analytics) is sent to it and fails, identically for both apps. */
const BLACKHOLE_PROXY = 'http://127.0.0.1:9'
const FIXTURE = 'stream'
const S: Selectors = {
  source: '[data-testid="input-textarea"]',
  main: '[data-testid="main-translation"]',
  copy: '[data-testid="output-toolbar"] [data-testid="copy-button"]',
  listen: '[data-testid="output-toolbar"] [data-testid="listen-button"]',
}
const CLEAR = '[data-testid="clear-input"]'
/** Keys typed one by one at the end of the settled-page translation text. */
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
  const interactions = runs * profiles.length
  console.log(
    `--live plan against ${args.url}: ${profiles.length} profile(s) x ${runs} ` +
      `run(s) = ${interactions} interaction run(s). Each makes at least 3 billed ` +
      'OpenAI translations (typing at first focus on a cold and on a repeat ' +
      'visit, one on the settled page) and up to 7 when typing at first focus is ' +
      'lost (a partial-text translation plus the retype, on each visit): ' +
      `${interactions * 3} to ${interactions * 7} billed translations. Page ` +
      'loads, the whitespace probe and TTFB requests are free.',
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

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .sort()
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

async function prepareFake(): Promise<{
  fake: Fake
  server: AppServer
  build: NonNullable<PerfFile['meta']['build']>
}> {
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
  const skipped = args['skip-build']
  let server: AppServer
  let build: NonNullable<PerfFile['meta']['build']>
  const port = PORTS[app]
  const url = `http://127.0.0.1:${port}`
  if (app === 'ts') {
    if (!skipped) {
      console.log('building the TS app (npm run build)…')
      execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
    }
    const output = join(ROOT, '.vercel/output')
    const hash = createHash('sha256')
    for (const path of filesUnder(output))
      hash.update(relative(output, path)).update(readFileSync(path))
    build = {
      skipped,
      sha256: hash.digest('hex'),
      assets: readdirSync(join(output, 'static/assets')).sort(),
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
    if (!skipped) {
      console.log('building the Go app (go build)…')
      execFileSync('go', ['build', '-o', appBin, '.'], {
        cwd: GO_DIR,
        stdio: 'inherit',
      })
    }
    build = { skipped, sha256: sha256(readFileSync(appBin)), assets: [] }
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
  return { fake, server, build }
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

/** Throttle proxy for a profile: transparent to `target` in --fake, an HTTP
 * CONNECT proxy in --live. */
async function startProxy(profile: Profile, target: string | null) {
  const network = profile.network!
  if (await portOpen(PORTS.proxy))
    throw new Error(`port ${PORTS.proxy} (throttle proxy) is already in use`)
  const proc = start(
    process.execPath,
    [join(ROOT, 'e2e/perf/throttle-proxy.mjs')],
    {
      ...process.env,
      PORT: String(PORTS.proxy),
      RTT_MS: String(network.rttMs),
      DOWN_BPS: String(bytesPerSecond(network.downloadKbps)),
      UP_BPS: String(bytesPerSecond(network.uploadKbps)),
      ...(target ? { TARGET: target } : {}),
    },
    ROOT,
  )
  await waitForPort(PORTS.proxy, proc.child, 'throttle proxy')
  return proc
}

// ----- browser helpers -------------------------------------------------------------

async function newPage(
  browser: Browser,
  profile: Profile,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ...profile.context,
    locale: 'en-US',
    serviceWorkers: 'block',
  })
  // tsx (esbuild keepNames) wraps named functions in `__name(...)`; the
  // functions this file serializes into the page need that helper there.
  await context.addInitScript({ content: 'globalThis.__name = (fn) => fn' })
  const page = await context.newPage()
  if (profile.browser === 'chromium' && profile.cpuSlowdown > 1) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', {
      rate: profile.cpuSlowdown,
    })
  }
  return { context, page }
}

function gzipSize(body: Buffer | string): number {
  if (body.length === 0) return 0
  return gzipSync(body, { level: zlibConstants.Z_BEST_COMPRESSION }).length
}

type ParseNode = {
  nodeName: string
  value?: string
  attrs?: Array<{ name: string; value: string }>
  childNodes?: ParseNode[]
  content?: ParseNode
}

const EXECUTABLE_SCRIPT_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
])

/** Inline <script> and <style> bodies of the served HTML (parsed with
 * parse5, the HTML parser jsdom uses), split into executable JS, CSS and
 * non-executable script data (JSON, import maps). */
function inlineCode(html: string) {
  const js: string[] = []
  const css: string[] = []
  const data: string[] = []
  const text = (node: ParseNode) =>
    (node.childNodes ?? []).map((c) => c.value ?? '').join('')
  const walk = (node: ParseNode) => {
    const attr = (name: string) =>
      node.attrs?.find((a) => a.name === name)?.value
    if (node.nodeName === 'script' && attr('src') === undefined) {
      const type = (attr('type') ?? '').trim().toLowerCase()
      ;(EXECUTABLE_SCRIPT_TYPES.has(type) ? js : data).push(text(node))
    } else if (node.nodeName === 'style') {
      css.push(text(node))
    }
    for (const child of node.childNodes ?? []) walk(child)
    if (node.content) walk(node.content)
  }
  walk(parse(html))
  const joined = (parts: string[]) => parts.join('\n')
  return {
    jsInlineRaw: Buffer.byteLength(joined(js)),
    jsInlineGzip: gzipSize(joined(js)),
    cssInlineRaw: Buffer.byteLength(joined(css)),
    cssInlineGzip: gzipSize(joined(css)),
    inlineDataRaw: Buffer.byteLength(joined(data)),
  }
}

function kindOf(response: Response, contentType: string): Resource['kind'] {
  const type = response.request().resourceType()
  if (type === 'document') return 'html'
  if (/javascript|ecmascript/.test(contentType) || type === 'script')
    return 'js'
  if (contentType.includes('text/css') || type === 'stylesheet') return 'css'
  return 'other'
}

/** Same-origin Resource Timing `transferSize` per URL, in fetch order
 * (headers + encoded body; 0 for an HTTP cache hit). Both engines report it;
 * Playwright's `request.sizes()` does not: Chromium returns negative sizes and
 * WebKit the full size for cache hits. */
type TransferSizes = Map<string, number[]>

async function transferSizes(page: Page): Promise<TransferSizes> {
  const entries = await page.evaluate(() =>
    (
      [
        ...performance.getEntriesByType('navigation'),
        ...performance.getEntriesByType('resource'),
      ] as PerformanceResourceTiming[]
    )
      .filter((e) => new URL(e.name).origin === location.origin)
      .map((e) => [e.name, e.transferSize] as const),
  )
  const map: TransferSizes = new Map()
  for (const [name, size] of entries)
    map.set(name, [...(map.get(name) ?? []), size])
  return map
}

async function describe(
  response: Response,
  rt: TransferSizes = new Map(),
): Promise<{
  resource: Resource
  totalBytes: number
  body: Buffer | null
}> {
  const sizes = await response
    .request()
    .sizes()
    .catch(() => null)
  // Cross-origin entries are opaque to Resource Timing without
  // Timing-Allow-Origin: fall back to Playwright's sizes there.
  const transferred =
    rt.get(response.url())?.shift() ??
    (sizes
      ? Math.max(0, sizes.responseBodySize) +
        Math.max(0, sizes.responseHeadersSize)
      : null)
  const contentType = (await response.headerValue('content-type')) ?? ''
  const kind = kindOf(response, contentType)
  const body = kind === 'other' ? null : await response.body().catch(() => null)
  return {
    resource: {
      url: response.url(),
      type: response.request().resourceType(),
      contentType,
      kind,
      status: response.status(),
      encoding: (await response.headerValue('content-encoding')) ?? null,
      raw: body?.length ?? 0,
      transferred,
      gzip: body ? gzipSize(body) : null,
      sha256: body ? sha256(body).slice(0, 16) : null,
    },
    totalBytes: transferred ?? 0,
    body,
  }
}

/** Collects every response (and failed request) of a page from now on. */
function collector(page: Page) {
  let responses: Response[] = []
  let failed: string[] = []
  page.on('response', (r) => responses.push(r))
  page.on('requestfailed', (r) =>
    failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`.trim()),
  )
  return {
    take() {
      const taken = { responses, failed }
      responses = []
      failed = []
      return taken
    },
  }
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 120_000 })
  await page.waitForTimeout(500)
}

async function measureLoad(
  page: Page,
  profile: Profile,
  url: string,
  responses: () => { responses: Response[]; failed: string[] },
): Promise<LoadRun> {
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForLoadState('networkidle', { timeout: 60_000 })
  // Quiet window for late long tasks and LCP candidates.
  await page.waitForTimeout(1000)
  const perf = await page.evaluate(readPerf)
  const rt = await transferSizes(page)
  const taken = responses()
  const resources: Resource[] = []
  let totalTransferred = 0
  let html: string | null = null
  for (const r of taken.responses) {
    const d = await describe(r, rt)
    totalTransferred += d.totalBytes
    if (d.resource.kind === 'other') continue
    resources.push(d.resource)
    if (d.resource.kind === 'html' && r.frame() === page.mainFrame() && d.body)
      html ??= d.body.toString('utf8')
  }
  const sum = (kind: Resource['kind'], key: 'raw' | 'transferred' | 'gzip') =>
    resources
      .filter((x) => x.kind === kind && x.status < 400)
      .reduce((total, x) => total + (x[key] ?? 0), 0)
  const inline = html
    ? inlineCode(html)
    : {
        jsInlineRaw: 0,
        jsInlineGzip: 0,
        cssInlineRaw: 0,
        cssInlineGzip: 0,
        inlineDataRaw: 0,
      }
  const htmlTransferred = sum('html', 'transferred')
  return {
    ...perf,
    docExpectedMs: profile.network
      ? htmlTransferred / (bytesPerSecond(profile.network.downloadKbps) / 1000)
      : null,
    jsRaw: sum('js', 'raw'),
    jsTransferred: sum('js', 'transferred'),
    jsGzip: sum('js', 'gzip'),
    ...inline,
    jsTotalRaw: sum('js', 'raw') + inline.jsInlineRaw,
    jsTotalGzip: sum('js', 'gzip') + inline.jsInlineGzip,
    cssRaw: sum('css', 'raw'),
    cssTransferred: sum('css', 'transferred'),
    cssGzip: sum('css', 'gzip'),
    htmlRaw: sum('html', 'raw'),
    htmlTransferred,
    totalTransferred,
    failedRequests: taken.failed,
    resources,
  }
}

/** Cold load in a fresh context, then a repeat navigation in the same
 * context after the first settled (warm HTTP cache, cookies kept). */
async function loadRun(
  browser: Browser,
  profile: Profile,
  url: string,
): Promise<{ cold: LoadRun; repeat: LoadRun }> {
  const { context, page } = await newPage(browser, profile)
  try {
    await page.addInitScript(installPerfObservers)
    const collect = collector(page)
    const cold = await measureLoad(page, profile, url, () => collect.take())
    const repeat = await measureLoad(page, profile, url, () => collect.take())
    return { cold, repeat }
  } finally {
    await context.close()
  }
}

class IsolationError extends Error {}

function translationText(): string {
  return `${mode === 'fake' ? `${fixture(FIXTURE).match} ` : ''}${nonce()} How are you doing today, my friend?`
}

function tracker(page: Page) {
  return page.evaluate(() => (window as unknown as PageGlobals).__tr)
}

async function waitForTracker(
  page: Page,
  field: 'first' | 'done',
  timeout: number,
): Promise<boolean> {
  return page
    .waitForFunction(
      (f) => (window as unknown as PageGlobals).__tr?.[f] != null,
      field,
      { timeout, polling: 50 },
    )
    .then(
      () => true,
      () => false,
    )
}

/** In --fake: did the upstream receive a translation of exactly `text`? */
async function upstreamSaw(fake: Fake | null, text: string): Promise<boolean> {
  if (!fake) return true
  const deadline = Date.now() + 5000
  for (;;) {
    if ((await fake.bodies()).some((b) => userText(b).includes(text)))
      return true
    if (Date.now() > deadline) return false
    await sleep(50)
  }
}

/** Clear (the app's own button: a user facing stale or mangled text does the
 * same) and wait until no main text and no enabled Copy remain. */
async function clearSource(page: Page): Promise<void> {
  await page.locator(CLEAR).click()
  await page.waitForFunction(
    (main) => !document.querySelector(main)?.textContent.trim(),
    S.main,
    { timeout: 10_000 },
  )
  if (
    await page.evaluate(
      (s) => document.querySelector<HTMLButtonElement>(s)?.disabled === false,
      S.copy,
    )
  )
    throw new Error('Copy is enabled after Clear')
}

const ACT_WAIT_MS = mode === 'fake' ? 3000 : 10_000

/** Typing at first focus: navigate, type one real sentence (ending "?") as
 * one burst the moment the textarea takes focus, then nothing. It counts if
 * the text survives the page settling AND a translation of exactly that text
 * arrives with no further input. Otherwise the input was dropped (wiped:
 * the field no longer holds it; ignored: it does, but nothing was
 * translated) and, after settle, the user clears the field (the app's Clear
 * button) and retypes a fresh sentence; that penalty is included. */
async function typeAtFirstFocus(
  page: Page,
  url: string,
  fake: Fake | null,
): Promise<TypeableRun> {
  const before = fake ? await fake.requests() : null
  await page.goto(url, { waitUntil: 'commit', timeout: 120_000 })
  const deadline = Date.now() + 120_000
  while (!(await page.evaluate(focusSource, S.source).catch(() => false))) {
    if (Date.now() > deadline)
      throw new Error('the source textarea never took focus')
    await page.waitForTimeout(10)
  }
  const text = translationText()
  await page.evaluate(() => (window as unknown as PageGlobals).__trStart())
  await page.keyboard.type(text)
  await settle(page)
  const settledAt = await page.evaluate(() => performance.now())
  const value = await page.locator(S.source).inputValue()
  const burst = await tracker(page)
  const kept = value === text
  const acted =
    kept &&
    (await waitForTracker(page, 'first', ACT_WAIT_MS)) &&
    (await upstreamSaw(fake, text))
  const fcp = await page.evaluate(
    () => (window as unknown as PageGlobals).__perf.fcp,
  )
  const result: TypeableRun = {
    fcp,
    burstFirstKey: burst?.firstKey ?? null,
    burstKept: kept,
    burstActed: acted,
    dropped: acted ? null : kept ? 'ignored' : 'wiped',
    settledAt,
    retypeFirstKey: null,
    firstTypeable: null,
    navToFirstChar: null,
    upstreamRequests: null,
  }
  let counted = burst
  if (!acted) {
    const retype = translationText()
    await clearSource(page)
    await page.evaluate(() => (window as unknown as PageGlobals).__trStart())
    await page.evaluate((selector) => {
      document
        .querySelector<HTMLTextAreaElement>(selector)!
        .focus({ preventScroll: true })
    }, S.source)
    await page.keyboard.type(retype)
    if ((await page.locator(S.source).inputValue()) !== retype)
      throw new Error('the retyped text did not stay in the field')
    if (!(await waitForTracker(page, 'first', 60_000)))
      throw new Error('no translation after retyping on the settled page')
    if (!(await upstreamSaw(fake, retype)))
      throw new IsolationError('the fake upstream never saw the retyped text')
    counted = await tracker(page)
    result.retypeFirstKey = counted?.firstKey ?? null
  }
  if (!(await waitForTracker(page, 'done', 60_000)))
    throw new Error('the counted translation never completed')
  counted = await tracker(page)
  const keystroke = counted?.firstKey ?? null
  result.firstTypeable =
    keystroke === null ? null : Math.max(fcp ?? 0, keystroke)
  result.navToFirstChar = counted?.first ?? null
  result.upstreamRequests = fake ? (await fake.requests()) - before! : null
  return result
}

/** A translation on the settled page: Clear, fill all but the last characters
 * and type those 60 ms apart; times from the last keystroke. */
async function settledTranslation(page: Page, fake: Fake | null) {
  await clearSource(page)
  const text = translationText()
  const before = fake ? await fake.requests() : null
  await page.evaluate(() => (window as unknown as PageGlobals).__trStart())
  const source = page.locator(S.source)
  await source.fill(text.slice(0, -TYPED_TAIL))
  await page.keyboard.type(text.slice(-TYPED_TAIL), { delay: TYPE_DELAY_MS })
  const typed = await source.inputValue()
  if (typed !== text)
    throw new Error(
      `source holds ${JSON.stringify(typed)}, expected the typed text`,
    )
  if (!(await waitForTracker(page, 'done', 60_000)))
    throw new Error('the settled-page translation never completed')
  const tr = (await tracker(page))!
  let upstreamRequests: number | null = null
  if (fake) {
    upstreamRequests = (await fake.requests()) - before!
    if (!(await upstreamSaw(fake, text)))
      throw new IsolationError('the fake upstream never saw this run’s text')
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

async function jsThroughDone(responses: Response[]) {
  let raw = 0
  let gzip = 0
  for (const r of responses) {
    const d = await describe(r)
    if (d.resource.status >= 400) continue
    if (d.resource.kind === 'js') {
      raw += d.resource.raw
      gzip += d.resource.gzip ?? 0
    } else if (d.resource.kind === 'html' && d.body) {
      const inline = inlineCode(d.body.toString('utf8'))
      raw += inline.jsInlineRaw
      gzip += inline.jsInlineGzip
    }
  }
  return { jsThroughDoneRaw: raw, jsThroughDoneGzip: gzip }
}

function keyboardResult(
  before: { mainTop: number | null; sourceTop: number | null },
  after: ReturnType<typeof layoutSnapshot>,
  shiftSum: number | null,
): KeyboardRun {
  const dy = (a: number | null, b: number | null) =>
    a === null || b === null ? null : Math.abs(b - a)
  return {
    shiftSum,
    mainDy: dy(before.mainTop, after.mainTop),
    sourceDy: dy(before.sourceTop, after.sourceTop),
    mainVisible: after.mainVisible,
    textareaVisible: after.textareaVisible,
    caretVisible: after.caretVisible,
    sourceFocused: after.sourceFocused,
  }
}

async function blurAndRest(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    document.querySelector<HTMLElement>(selector)?.blur()
  }, S.source)
  await page.waitForTimeout(400)
}

async function focusEnd(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const el = document.querySelector<HTMLTextAreaElement>(selector)!
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, S.source)
}

/** Overlays-content keyboard (iOS Safari, Android default): the layout
 * viewport keeps its size; the visual viewport shrinks in 50 px steps, 50 ms
 * apart, to half the window, then pans down (offsetTop), as in
 * tests/browser/mobile.browser.tsx. resize + scroll fire on every step. */
async function keyboardVisual(page: Page): Promise<KeyboardRun> {
  await blurAndRest(page)
  const before = await page.evaluate(layoutSnapshot, {
    main: S.main,
    source: S.source,
    band: null,
  })
  await page.evaluate(startShiftObserver)
  await focusEnd(page)
  const full = await page.evaluate(() => window.innerHeight)
  const visible = Math.round(full * 0.5)
  const offset = Math.round(full * 0.125)
  const set = (height: number | null, top: number | null) =>
    page.evaluate(
      ([h, t]) => (window as unknown as PageGlobals).__keyboard!.set(h, t),
      [height, top] as const,
    )
  for (let h = full - 50; h > visible; h -= 50) {
    await set(h, 0)
    await page.waitForTimeout(50)
  }
  await set(visible, offset)
  await page.waitForTimeout(600)
  const shiftSum = await page.evaluate(stopShiftObserver)
  const after = await page.evaluate(layoutSnapshot, {
    main: S.main,
    source: S.source,
    band: { top: offset, height: visible },
  })
  await blurAndRest(page)
  await set(null, null)
  await page.waitForTimeout(600)
  return keyboardResult(before, after, shiftSum)
}

/** Resizes-content keyboard: the layout viewport itself shrinks
 * (page.setViewportSize) in 50 px steps, 50 ms apart, to half its height. */
async function keyboardResize(
  page: Page,
  profile: Profile,
): Promise<KeyboardRun> {
  const size = profile.context.viewport!
  await blurAndRest(page)
  const before = await page.evaluate(layoutSnapshot, {
    main: S.main,
    source: S.source,
    band: null,
  })
  await page.evaluate(startShiftObserver)
  await focusEnd(page)
  const visible = Math.round(size.height * 0.5)
  for (let h = size.height - 50; h > visible; h -= 50) {
    await page.setViewportSize({ width: size.width, height: h })
    await page.waitForTimeout(50)
  }
  await page.setViewportSize({ width: size.width, height: visible })
  await page.waitForTimeout(600)
  const shiftSum = await page.evaluate(stopShiftObserver)
  const after = await page.evaluate(layoutSnapshot, {
    main: S.main,
    source: S.source,
    band: { top: 0, height: visible },
  })
  await blurAndRest(page)
  await page.setViewportSize(size)
  await page.waitForTimeout(600)
  return keyboardResult(before, after, shiftSum)
}

async function interactRun(
  browser: Browser,
  profile: Profile,
  url: string,
  fake: Fake | null,
): Promise<InteractRun> {
  const { context, page } = await newPage(browser, profile)
  try {
    await page.addInitScript(installPerfObservers)
    await page.addInitScript(installInputTracker, S)
    if (profile.keyboard) await page.addInitScript(installFakeVisualViewport)
    const collect = collector(page)
    const cold = await typeAtFirstFocus(page, url, fake)
    const translation = await settledTranslation(page, fake)
    const js = await jsThroughDone(collect.take().responses)
    const keyboardV = profile.keyboard ? await keyboardVisual(page) : null
    const keyboardR = profile.keyboard
      ? await keyboardResize(page, profile)
      : null
    const repeat = await typeAtFirstFocus(page, url, fake)
    return {
      cold,
      repeat,
      ...translation,
      ...js,
      keyboardVisual: keyboardV,
      keyboardResize: keyboardR,
    }
  } finally {
    await context.close()
  }
}

/** Diagnostic: from `commit` on, type a space whenever the textarea takes
 * focus, until network idle + 5 more tries. A keystroke counts as kept if
 * its character is still there after settle. Whitespace-only input must
 * never reach the upstream (checked in --fake). */
async function probeRun(
  browser: Browser,
  profile: Profile,
  url: string,
  fake: Fake | null,
): Promise<ProbeRun> {
  const { context, page } = await newPage(browser, profile)
  try {
    await page.addInitScript(installInputTracker, S)
    const before = fake ? await fake.requests() : null
    await page.goto(url, { waitUntil: 'commit', timeout: 120_000 })
    const state = { idle: false }
    const idle = page
      .waitForLoadState('networkidle', { timeout: 120_000 })
      .then(() => (state.idle = true))
    let afterIdle = 0
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const focused = await page
        .evaluate(focusSource, S.source)
        .catch(() => false)
      if (focused) await page.keyboard.type(' ')
      if (state.idle && ++afterIdle >= 5) break
      await page.waitForTimeout(state.idle ? 100 : focused ? 25 : 10)
    }
    await idle
    // Longer than the 800 ms debounce for text without final punctuation.
    await page.waitForTimeout(1500)
    const events = await page.evaluate(
      () => (window as unknown as PageGlobals).__inputs,
    )
    const value = await page.locator(S.source).inputValue()
    const whitespaceRequests = fake ? (await fake.requests()) - before! : null
    const survivors = value.length
    const shown = events[0] ?? null
    if (value.trim() !== '' || survivors === 0 || survivors > events.length)
      return {
        kept: null,
        shown,
        lastLost: null,
        attempts: events.length,
        whitespaceRequests,
      }
    return {
      kept: events[events.length - survivors]!,
      shown,
      lastLost: events[events.length - survivors - 1] ?? null,
      attempts: events.length,
      whitespaceRequests,
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
  appUrl: string,
  fake: Fake | null,
  warmUp: boolean,
): Promise<ProfileResult> {
  let url = appUrl
  let proxy: ReturnType<typeof start> | null = null
  const launch: LaunchOptions = {}
  if (profile.network) {
    if (mode === 'fake') {
      proxy = await startProxy(profile, new URL(appUrl).host)
      url = `http://127.0.0.1:${PORTS.proxy}`
    } else {
      proxy = await startProxy(profile, null)
      launch.proxy = { server: `http://127.0.0.1:${PORTS.proxy}` }
    }
  }
  if (mode === 'fake')
    launch.proxy = {
      server: BLACKHOLE_PROXY,
      bypass: '127.0.0.1,localhost',
    }
  const browser = await (
    profile.browser === 'webkit' ? webkit : chromium
  ).launch(launch)
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
      // measured runs see a warm instance (cold TTFB is measured apart).
      await loadRun(browser, profile, url)
      if (fake) await interactRun(browser, profile, url, fake)
    }
    const result: ProfileResult = {
      profile: profileDescription(profile),
      browserVersion: browser.version(),
      supportedEntryTypes,
      load: [],
      loadRepeat: [],
      interact: [],
      probe: [],
    }
    for (let i = 0; i < runs; i++) {
      const load = await attempt(`load ${i + 1}`, () =>
        loadRun(browser, profile, url),
      )
      result.load.push('error' in load ? load : load.cold)
      result.loadRepeat.push(
        'error' in load
          ? { error: '(same failure as the cold load)' }
          : load.repeat,
      )
      result.interact.push(
        await attempt(`interact ${i + 1}`, () =>
          interactRun(browser, profile, url, fake),
        ),
      )
      result.probe.push(
        await attempt(`probe ${i + 1}`, () =>
          probeRun(browser, profile, url, fake),
        ),
      )
      process.stdout.write(`  ${profile.id}: run ${i + 1}/${runs}\n`)
    }
    return result
  } finally {
    await browser.close()
    if (proxy) await stop(proxy.child)
  }
}

function git(...argv: string[]): string {
  return execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8' }).trim()
}

async function measure(): Promise<void> {
  let url: string
  let fake: Fake | null = null
  let server: PerfFile['server']
  let build: PerfFile['meta']['build'] = null
  let appProc: ReturnType<typeof start> | null = null
  if (mode === 'fake') {
    const prepared = await prepareFake()
    fake = prepared.fake
    build = prepared.build
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

  const network = profiles
    .filter((p) => p.network)
    .map((p) => p.id)
    .join(', ')
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
      machine: {
        platform: `${platform()} ${release()}`,
        arch: arch(),
        cpu: cpus()[0]?.model ?? 'unknown',
        cores: cpus().length,
        memoryGiB: Math.round(totalmem() / 2 ** 30),
      },
      playwright: (
        JSON.parse(
          readFileSync(
            join(ROOT, 'node_modules/playwright/package.json'),
            'utf8',
          ),
        ) as { version: string }
      ).version,
      build,
      text: `${mode === 'fake' ? `${fixture(FIXTURE).match} ` : ''}<nonce> How are you doing today, my friend?`,
      debounce:
        'The text ends in "?", so both apps use the 400 ms sentence-final debounce; it is inside every translation timing.',
      compression:
        mode === 'fake'
          ? 'Local servers send everything uncompressed (one policy for every app); compare the computed gzip sizes.'
          : 'As served by the deployment (see each resource’s encoding).',
      network:
        `Throttled profiles (${network || 'none'}) go through e2e/perf/throttle-proxy.mjs: one shared link, ` +
        'RTT per request, +1 RTT per new connection, shared down/up bandwidth, for both engines. ' +
        (mode === 'fake'
          ? 'Every non-loopback request (CDN fonts, analytics) is sent to a closed proxy port and fails, for every app.'
          : 'In --live the proxy is the browser’s HTTP CONNECT proxy, so third-party requests are throttled too.'),
      notes: [
        'TTFB/FCP/LCP/DOMContentLoaded/load are ms from navigation start (Navigation and Paint Timing, PerformanceObserver).',
        'First typeable = max(FCP, earliest kept keystroke, earliest acted-on keystroke) for one sentence typed as a burst at the first moment the textarea takes focus; a dropped burst is cleared and retyped after the page settles (network idle + 500 ms) and that penalty is included.',
        'TBT = sum over long tasks of the part after FCP beyond 50 ms, until 1 s after network idle (Chromium only: WebKit has no longtask entries).',
        'LCP and CLS need largest-contentful-paint / layout-shift entries; supportedEntryTypes per profile says which engine has them.',
        '"First main char" is the DOM mutation that first shows main text (MutationObserver, performance.now()), not a paint.',
        'JS total = external script bodies + executable inline <script> of the document; gzip = gzip -9 of decoded bodies.',
        'Keyboard dy is not "lower is better": read it together with the visibility flags.',
        'Every load starts in a fresh browser context (empty cache, no cookies, service workers blocked); repeat = second navigation in the same context.',
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
