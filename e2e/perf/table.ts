// Results format of e2e/perf/measure.ts and the markdown table writer used by
// the baseline (Task 5) and the TS vs Go comparison (Task 13).
//
//   npx tsx e2e/perf/table.ts ts.json [go.json ...] [--allow-mismatch]
//
// Statistics are inline (median + nearest-rank p90 over at most tens of
// samples); no library needed for two order statistics.
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import type { ProfileDescription } from './profiles'

export type Resource = {
  url: string
  /** Playwright resource type and response content-type. */
  type: string
  contentType: string
  kind: 'js' | 'css' | 'html' | 'other'
  status: number
  encoding: string | null
  raw: number
  /** Headers + encoded body on the wire: same-origin Resource Timing
   * transferSize (0 = HTTP cache hit), else Playwright's sizes. */
  transferred: number | null
  gzip: number | null
  /** First 16 hex chars of the body's sha256 (build provenance). */
  sha256: string | null
}

/** One page load (cold: fresh context; repeat: second navigation in the same
 * context after the first settled). */
export type LoadRun = {
  ttfb: number | null
  /** Navigation responseEnd - responseStart, and what the simulated link
   * needs for the document's transferred bytes (null when unthrottled). */
  docTransferMs: number | null
  docExpectedMs: number | null
  fcp: number | null
  lcp: number | null
  tbt: number | null
  domContentLoaded: number | null
  load: number | null
  loadCls: number | null
  jsRaw: number
  jsTransferred: number
  jsGzip: number
  jsInlineRaw: number
  jsInlineGzip: number
  /** External + inline: the deciding JS size. */
  jsTotalRaw: number
  jsTotalGzip: number
  /** Non-executable inline <script> (JSON, import maps). */
  inlineDataRaw: number
  cssRaw: number
  cssTransferred: number
  cssGzip: number
  cssInlineRaw: number
  cssInlineGzip: number
  htmlRaw: number
  htmlTransferred: number
  totalTransferred: number
  /** Requests that failed (blocked third-party hosts in --fake). */
  failedRequests: string[]
  resources: Resource[]
}

/** Typing a real sentence at the first moment the textarea takes focus. */
export type TypeableRun = {
  fcp: number | null
  /** First input event of the burst typed at first focus. */
  burstFirstKey: number | null
  /** The burst's text was still in the field after the page settled. */
  burstKept: boolean
  /** A translation of exactly that text arrived with no further input. */
  burstActed: boolean
  /** null when the burst was kept and acted on; otherwise how it was lost. */
  dropped: 'wiped' | 'ignored' | null
  /** First input event of the retype after settle (only when dropped). */
  /** performance.now() when the harness considered the page settled
   * (network idle + 500 ms) and judged the burst. */
  settledAt: number | null
  retypeFirstKey: number | null
  /** max(FCP, earliest kept keystroke, earliest acted-on keystroke). */
  firstTypeable: number | null
  /** Navigation start to the first main character of the translation that
   * counted (the burst's, or the retype's including the penalty). */
  navToFirstChar: number | null
  upstreamRequests: number | null
}

export type KeyboardRun = {
  shiftSum: number | null
  mainDy: number | null
  sourceDy: number | null
  mainVisible: boolean | null
  textareaVisible: boolean | null
  caretVisible: boolean | null
  sourceFocused: boolean | null
  /** Final visual-viewport offsetTop chosen by the scroll-to-caret model
   * (visual mode only). */
  panOffset: number | null
}

/** One interaction run: fresh context; typing at first focus, a translation
 * on the settled page, (mobile) the keyboard simulations, then a repeat visit
 * with typing at first focus. */
export type InteractRun = {
  cold: TypeableRun
  repeat: TypeableRun
  keyToFirstChar: number | null
  keyToCopy: number | null
  keyToDone: number | null
  upstreamRequests: number | null
  /** All JS the page loaded from navigation through the settled translation's
   * "done" (external bodies + the document's inline scripts). */
  /** Diagnostic: last key to the main Listen button enabling, if the app has
   * one (not used for "done"). */
  keyToListen: number | null
  /** End of the last request started after the last keystroke minus the last
   * DOM change: > 0 means the response stayed open after the page stopped
   * changing (e.g. an SSE response not closed after its final event). */
  streamEndMinusLastDom: number | null
  jsThroughDoneRaw: number
  jsThroughDoneGzip: number
  /** visualViewport shrink + offsetTop pan (overlays-content keyboards). */
  keyboardVisual: KeyboardRun | null
  /** Layout viewport shrink via setViewportSize (resizes-content). */
  keyboardResize: KeyboardRun | null
}

/** Diagnostic run: spaces typed whenever the textarea can take focus during
 * load (the original first-typeable probe). */
export type ProbeRun = {
  fcp: number | null
  /** Earliest keystroke still in the field after settle. */
  kept: number | null
  /** Earliest input event at all (it may be lost later). */
  shown: number | null
  /** The lost keystroke just before the first kept one. */
  lastLost: number | null
  attempts: number
  /** Upstream requests caused by whitespace-only input (must be 0). */
  whitespaceRequests: number | null
}

type Failed = { error: string }

export type ProfileResult = {
  profile: ProfileDescription
  browserVersion: string
  supportedEntryTypes: string[]
  load: Array<LoadRun | Failed>
  loadRepeat: Array<LoadRun | Failed>
  interact: Array<InteractRun | Failed>
  probe: Array<ProbeRun | Failed>
}

export type Machine = {
  platform: string
  arch: string
  cpu: string
  cores: number
  memoryGiB: number
}

export type PerfFile = {
  meta: {
    app: 'ts' | 'go'
    mode: 'fake' | 'live'
    url: string
    date: string
    commit: string
    dirty: boolean
    runs: number
    node: string
    machine: Machine
    playwright: string
    /** sha256 over e2e/perf sources at measure time. */
    harness: string
    build: {
      skipped: boolean
      /** sha256 over the served build (TS: .vercel/output; Go: binary). */
      sha256: string
      assets: string[]
    } | null
    text: string
    debounce: string
    compression: string
    network: string
    notes: string[]
  }
  server: {
    note: string
    coldTtfb: number[]
    warmTtfb: number[]
  }
  profiles: ProfileResult[]
}

// ----- statistics ----------------------------------------------------------------

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Nearest-rank percentile: the smallest sample with at least p% of samples
 * at or below it (p90 of 10 runs = the 9th smallest). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!
}

export type Summary = { median: number | null; p90: number | null; n: number }

export function summarize(values: number[]): Summary {
  return {
    median: median(values),
    p90: percentile(values, 90),
    n: values.length,
  }
}

// ----- metrics -------------------------------------------------------------------

type Unit = 'ms' | 'bytes' | 'score' | 'px' | 'flag'
type Value = number | boolean | null

type Metric<TRun> = {
  label: string
  unit: Unit
  get: (run: TRun) => Value
  /** Rows only for profiles that simulate the keyboard. */
  keyboard?: boolean
}

type Section = {
  title: string
  rows: (r: ProfileResult) => Array<{
    metric: Metric<never>
    runs: Array<object>
  }>
}

function rows<TRun extends object>(
  runs: (r: ProfileResult) => Array<TRun | Failed>,
  metrics: Metric<TRun>[],
) {
  return (r: ProfileResult) =>
    metrics.map((metric) => ({
      metric: metric,
      runs: ok(runs(r)),
    }))
}

const loadMetrics = (suffix: string): Metric<LoadRun>[] => [
  { label: `TTFB${suffix}`, unit: 'ms', get: (r) => r.ttfb },
  {
    label: `Document transfer (responseEnd - responseStart)${suffix}`,
    unit: 'ms',
    get: (r) => r.docTransferMs,
  },
  {
    label: `Document transfer expected on the link${suffix}`,
    unit: 'ms',
    get: (r) => r.docExpectedMs,
  },
  { label: `FCP${suffix}`, unit: 'ms', get: (r) => r.fcp },
  { label: `LCP${suffix}`, unit: 'ms', get: (r) => r.lcp },
  { label: `TBT (FCP to quiet)${suffix}`, unit: 'ms', get: (r) => r.tbt },
  {
    label: `DOMContentLoaded${suffix}`,
    unit: 'ms',
    get: (r) => r.domContentLoaded,
  },
  { label: `load event${suffix}`, unit: 'ms', get: (r) => r.load },
  { label: `CLS during load${suffix}`, unit: 'score', get: (r) => r.loadCls },
]

const SIZE_METRICS: Metric<LoadRun>[] = [
  {
    label: '**JS total gzip (external + inline)**',
    unit: 'bytes',
    get: (r) => r.jsTotalGzip,
  },
  {
    label: 'JS total raw (external + inline)',
    unit: 'bytes',
    get: (r) => r.jsTotalRaw,
  },
  { label: 'JS external raw', unit: 'bytes', get: (r) => r.jsRaw },
  {
    label: 'JS external transferred (incl. headers)',
    unit: 'bytes',
    get: (r) => r.jsTransferred,
  },
  { label: 'JS external gzip -9', unit: 'bytes', get: (r) => r.jsGzip },
  { label: 'JS inline raw', unit: 'bytes', get: (r) => r.jsInlineRaw },
  { label: 'JS inline gzip -9', unit: 'bytes', get: (r) => r.jsInlineGzip },
  {
    label: 'Inline data scripts raw (JSON)',
    unit: 'bytes',
    get: (r) => r.inlineDataRaw,
  },
  { label: 'CSS external raw', unit: 'bytes', get: (r) => r.cssRaw },
  {
    label: 'CSS external transferred (incl. headers)',
    unit: 'bytes',
    get: (r) => r.cssTransferred,
  },
  { label: 'CSS external gzip -9', unit: 'bytes', get: (r) => r.cssGzip },
  { label: 'CSS inline raw', unit: 'bytes', get: (r) => r.cssInlineRaw },
  { label: 'CSS inline gzip -9', unit: 'bytes', get: (r) => r.cssInlineGzip },
  { label: 'HTML raw', unit: 'bytes', get: (r) => r.htmlRaw },
  {
    label: 'HTML transferred (incl. headers)',
    unit: 'bytes',
    get: (r) => r.htmlTransferred,
  },
  {
    label: 'All transferred (incl. headers)',
    unit: 'bytes',
    get: (r) => r.totalTransferred,
  },
]

const REPEAT_SIZE_METRICS: Metric<LoadRun>[] = [
  {
    label: 'JS external transferred (repeat; 0 = cache hit)',
    unit: 'bytes',
    get: (r) => r.jsTransferred,
  },
  {
    label: 'All transferred (repeat)',
    unit: 'bytes',
    get: (r) => r.totalTransferred,
  },
]

type Paired = { interact: InteractRun; probe: ProbeRun }

/** Interaction and probe runs of the same iteration, both successful. */
function paired(r: ProfileResult): Array<Paired | Failed> {
  return r.interact.map((interact, i) => {
    const probe = r.probe[i]
    if ('error' in interact) return interact
    if (!probe || 'error' in probe) return { error: 'probe failed' }
    return { interact, probe }
  })
}

/** max(FCP, earliest kept keystroke) of the probe run. */
function keptFrom(probe: ProbeRun): number | null {
  return probe.kept === null ? null : Math.max(probe.fcp ?? 0, probe.kept)
}

/** Headline "first typeable (kept and acted on)": the burst typed at first
 * focus counts only if it stayed in the field AND was translated; then it is
 * max(FCP, earliest kept keystroke, earliest acted-on keystroke) of that same
 * run (TypeableRun.firstTypeable). A dropped burst has no kept-and-acted
 * moment (n/a); the gate rows beside it say why, and the retype model is only
 * the secondary "dropped-run penalty". */
function keptAndActed(t: TypeableRun): number | null {
  return t.burstActed ? t.firstTypeable : null
}

const gateMetrics = (which: 'cold' | 'repeat'): Metric<Paired>[] => {
  const s = which === 'cold' ? '' : ' (repeat visit)'
  return [
    {
      label: `**First typeable (kept and acted on)**${s}`,
      unit: 'ms',
      get: (r) => keptAndActed(r.interact[which]),
    },
    {
      label: `Gate: typing at first focus wiped${s}`,
      unit: 'flag',
      get: (r) => r.interact[which].dropped === 'wiped',
    },
    {
      label: `Gate: typing at first focus ignored${s}`,
      unit: 'flag',
      get: (r) => r.interact[which].dropped === 'ignored',
    },
    {
      label: `Wiped and the remainder translated (extra upstream request)${s}`,
      unit: 'flag',
      get: (r) =>
        r.interact[which].upstreamRequests === null
          ? null
          : r.interact[which].dropped === 'wiped' &&
            r.interact[which].upstreamRequests > 1,
    },
    {
      label: `First focus (burst first keystroke)${s}`,
      unit: 'ms',
      get: (r) => r.interact[which].burstFirstKey,
    },
    {
      label: `Nav start to first main char, typing at first focus (dropped runs: after the retype)${s}`,
      unit: 'ms',
      get: (r) => r.interact[which].navToFirstChar,
    },
  ]
}

/** Secondary: a dropped burst handled by the retype model (settle point,
 * Clear, retype a fresh sentence). Never the headline. */
const penaltyMetrics = (which: 'cold' | 'repeat'): Metric<Paired>[] => {
  const s = which === 'cold' ? '' : ' (repeat visit)'
  return [
    {
      label: `First typeable incl. the retype model${s}`,
      unit: 'ms',
      get: (r) => r.interact[which].firstTypeable,
    },
    {
      label: `of which harness wait (settle point - input kept from), dropped runs${s}`,
      unit: 'ms',
      get: (r) => {
        const kept = keptFrom(r.probe)
        const t = r.interact[which]
        return t.dropped && t.settledAt !== null && kept !== null
          ? t.settledAt - kept
          : null
      },
    },
    {
      label: `Harness settle point, dropped runs${s}`,
      unit: 'ms',
      get: (r) =>
        r.interact[which].dropped ? r.interact[which].settledAt : null,
    },
    {
      label: `Clear + retype after settle, dropped runs${s}`,
      unit: 'ms',
      get: (r) => {
        const t = r.interact[which]
        return t.retypeFirstKey === null || t.settledAt === null
          ? null
          : t.retypeFirstKey - t.settledAt
      },
    },
  ]
}

const keyboardMetrics = (
  which: 'keyboardVisual' | 'keyboardResize',
  name: string,
): Metric<InteractRun>[] => [
  {
    label: `${name}: final visual viewport offsetTop (scroll-to-caret model)`,
    unit: 'px',
    get: (r) => r[which]?.panOffset ?? null,
    keyboard: true,
  },
  {
    label: `${name}: layout-shift sum`,
    unit: 'score',
    get: (r) => r[which]?.shiftSum ?? null,
    keyboard: true,
  },
  {
    label: `${name}: main text dy`,
    unit: 'px',
    get: (r) => r[which]?.mainDy ?? null,
    keyboard: true,
  },
  {
    label: `${name}: source textarea dy`,
    unit: 'px',
    get: (r) => r[which]?.sourceDy ?? null,
    keyboard: true,
  },
  {
    label: `${name}: main text visible`,
    unit: 'flag',
    get: (r) => r[which]?.mainVisible ?? null,
    keyboard: true,
  },
  {
    label: `${name}: textarea visible`,
    unit: 'flag',
    get: (r) => r[which]?.textareaVisible ?? null,
    keyboard: true,
  },
  {
    label: `${name}: caret visible`,
    unit: 'flag',
    get: (r) => r[which]?.caretVisible ?? null,
    keyboard: true,
  },
  {
    label: `${name}: textarea keeps focus`,
    unit: 'flag',
    get: (r) => r[which]?.sourceFocused ?? null,
    keyboard: true,
  },
]

const SECTIONS: Section[] = [
  {
    title: 'Page load, cold cache',
    rows: rows((r) => r.load, [...loadMetrics(''), ...SIZE_METRICS]),
  },
  {
    title:
      'Typing during load (headline: first typeable, kept and acted on; gate: wiped/ignored, i.e. not acted on)',
    rows: rows(paired, [
      ...gateMetrics('cold'),
      {
        label:
          'Input kept from (max(FCP, earliest kept keystroke), space probe)',
        unit: 'ms',
        get: (r) => keptFrom(r.probe),
      },
      ...gateMetrics('repeat'),
    ]),
  },
  {
    title:
      'Dropped-run penalty (secondary: retype model = settle, Clear, retype)',
    rows: rows(paired, [
      ...penaltyMetrics('cold'),
      ...penaltyMetrics('repeat').filter(
        (m) => !m.label.startsWith('of which'),
      ),
    ]),
  },
  {
    title: 'Page load, repeat visit (same context, warm cache)',
    rows: rows(
      (r) => r.loadRepeat,
      [
        ...loadMetrics(' (repeat)').filter(
          (m) => !m.label.startsWith('Document'),
        ),
        ...REPEAT_SIZE_METRICS,
      ],
    ),
  },
  {
    title: 'Translation on the settled page',
    rows: rows(
      (r) => r.interact,
      [
        {
          label: 'Last key to first main char',
          unit: 'ms',
          get: (r) => r.keyToFirstChar,
        },
        {
          label: 'Last key to Copy enabled',
          unit: 'ms',
          get: (r) => r.keyToCopy,
        },
        {
          label: 'Last key to done (stream ended + Copy + DOM quiet 500 ms)',
          unit: 'ms',
          get: (r) => r.keyToDone,
        },
        {
          label: 'Request end minus last DOM change (> 0: response held open)',
          unit: 'ms',
          get: (r) => r.streamEndMinusLastDom,
        },
        {
          label: 'Diagnostic: last key to Listen enabled (if the app has it)',
          unit: 'ms',
          get: (r) => r.keyToListen,
        },
        {
          label: 'JS loaded through done, gzip -9',
          unit: 'bytes',
          get: (r) => r.jsThroughDoneGzip,
        },
        {
          label: 'JS loaded through done, raw',
          unit: 'bytes',
          get: (r) => r.jsThroughDoneRaw,
        },
      ],
    ),
  },
  {
    title:
      'Keyboard open (simulated; dy is not "lower is better", read it with visibility)',
    rows: rows(
      (r) => r.interact,
      [
        ...keyboardMetrics('keyboardVisual', 'visualViewport shrink + pan'),
        ...keyboardMetrics('keyboardResize', 'Layout viewport resize'),
      ],
    ),
  },
  {
    title: 'Diagnostics: space probe during load',
    rows: rows(
      (r) => r.probe,
      [
        { label: 'Earliest kept keystroke', unit: 'ms', get: (r) => r.kept },
        {
          label: 'Earliest keystroke shown (may be lost)',
          unit: 'ms',
          get: (r) => r.shown,
        },
        {
          label: 'Probe resolution (kept - last lost)',
          unit: 'ms',
          get: (r) =>
            r.kept === null || r.lastLost === null ? null : r.kept - r.lastLost,
        },
        {
          label: 'Whitespace input reached upstream',
          unit: 'flag',
          get: (r) =>
            r.whitespaceRequests === null ? null : r.whitespaceRequests > 0,
        },
      ],
    ),
  },
]

function ok<TRun extends object>(runs: Array<TRun | Failed>): TRun[] {
  return runs.filter((r): r is TRun => !('error' in r))
}

function format(value: number | null, unit: Unit): string {
  if (value === null) return 'n/a'
  switch (unit) {
    case 'ms':
      return `${Math.round(value)} ms`
    case 'px':
      return `${Math.round(value)} px`
    case 'score':
      return value.toFixed(3)
    case 'flag':
      return String(value)
    case 'bytes':
      return value >= 10_000
        ? `${(value / 1024).toFixed(1)} KiB`
        : `${Math.round(value)} B`
  }
}

function cell(
  metric: Metric<never>,
  runs: Array<object>,
  expected: number,
): string {
  const values = runs.map((r) => metric.get(r as never))
  if (metric.unit === 'flag') {
    const known = values.filter((v): v is boolean => typeof v === 'boolean')
    if (known.length === 0) return 'n/a'
    return `${known.filter(Boolean).length}/${known.length} yes`
  }
  const numbers = values.filter((v): v is number => typeof v === 'number')
  if (numbers.length === 0) return 'n/a'
  const s = summarize(numbers)
  const missing = s.n < expected ? ` (n=${s.n})` : ''
  return `${format(s.median, metric.unit)} / ${format(s.p90, metric.unit)}${missing}`
}

function fileLabel(file: PerfFile): string {
  return `${file.meta.app} (${file.meta.mode})`
}

/** Files must share profile definitions; browser versions, Playwright and
 * machine must match too unless `allowMismatch` (then the differences are
 * printed as warnings above the tables). */
export function comparability(
  files: PerfFile[],
  allowMismatch: boolean,
): string[] {
  const [first, ...rest] = files
  const warnings: string[] = []
  for (const other of rest) {
    const pair = `${fileLabel(first!)} vs ${fileLabel(other)}`
    for (const p of other.profiles) {
      const match = first!.profiles.find((q) => q.profile.id === p.profile.id)
      if (!match) continue
      if (!isDeepStrictEqual(match.profile, p.profile))
        throw new Error(
          `profile ${p.profile.id} differs (${pair}); re-measure with the same profiles.ts`,
        )
      if (match.browserVersion !== p.browserVersion)
        warnings.push(
          `${p.profile.id}: browser ${match.browserVersion} vs ${p.browserVersion} (${pair})`,
        )
    }
    if (first!.meta.mode !== other.meta.mode)
      warnings.push(`mode ${first!.meta.mode} vs ${other.meta.mode} (${pair})`)
    const harness = (f: PerfFile) =>
      (f.meta.harness as string | undefined)?.slice(0, 12) ?? 'not recorded'
    if (harness(first!) !== harness(other) || !first!.meta.harness)
      warnings.push(
        `harness ${harness(first!)} vs ${harness(other)} (${pair}): e2e/perf changed between the runs or was not recorded`,
      )
    if (first!.meta.playwright !== other.meta.playwright)
      warnings.push(
        `Playwright ${first!.meta.playwright} vs ${other.meta.playwright} (${pair})`,
      )
    if (!isDeepStrictEqual(first!.meta.machine, other.meta.machine))
      warnings.push(
        `machine ${JSON.stringify(first!.meta.machine)} vs ${JSON.stringify(other.meta.machine)} (${pair})`,
      )
  }
  if (warnings.length && !allowMismatch)
    throw new Error(
      `results are not comparable:\n- ${warnings.join('\n- ')}\n` +
        'Re-measure on the same setup, or pass --allow-mismatch to print them with a warning.',
    )
  return warnings
}

/** Markdown: per profile, one table per section, a column per file, each cell
 * "median / p90" (flags: "k/n yes"). Then server TTFB and provenance. */
export function markdownTables(
  files: PerfFile[],
  { allowMismatch = false } = {},
): string {
  if (files.length === 0) throw new Error('no results files')
  const warnings = comparability(files, allowMismatch)
  const out: string[] = []
  if (warnings.length)
    out.push(
      '> **Warning: setups differ**',
      ...warnings.map((w) => `> - ${w}`),
      '',
    )
  const header = `| Metric | ${files.map((f) => `${fileLabel(f)} median / p90`).join(' | ')} |`
  const rule = `|---|${files.map(() => '---|').join('')}`
  const ids = [
    ...new Set(files.flatMap((f) => f.profiles.map((p) => p.profile.id))),
  ]
  for (const id of ids) {
    const results = files.map((f) =>
      f.profiles.find((p) => p.profile.id === id),
    )
    const any = results.find(Boolean)!
    out.push(`#### ${id}`, '', any.profile.label, '')
    for (const section of SECTIONS) {
      const perFile = results.map((r) => (r ? section.rows(r) : null))
      const template = perFile.find(Boolean)!
      const lines: string[] = []
      template.forEach(({ metric }, row) => {
        if (metric.keyboard && !any.profile.keyboard) return
        const cells = files.map((f, i) => {
          const entry = perFile[i]?.[row]
          return entry ? cell(entry.metric, entry.runs, f.meta.runs) : '-'
        })
        lines.push(`| ${metric.label} | ${cells.join(' | ')} |`)
      })
      if (lines.length === 0) continue
      out.push(`##### ${section.title}`, '', header, rule, ...lines, '')
    }
    const errors = results.flatMap((r, i) =>
      r
        ? [...r.load, ...r.loadRepeat, ...r.interact, ...r.probe]
            .filter((x): x is Failed => 'error' in x)
            .map((x) => `${fileLabel(files[i]!)}: ${x.error}`)
        : [],
    )
    if (errors.length)
      out.push(
        `Failed runs (${errors.length}):`,
        '',
        ...errors.map((e) => `- ${e}`),
        '',
      )
  }
  out.push('#### Server TTFB (Node client, no browser)', '', header, rule)
  for (const [key, label] of [
    ['coldTtfb', 'Cold (first request)'],
    ['warmTtfb', 'Warm'],
  ] as const) {
    out.push(
      `| ${label} | ${files
        .map((f) => {
          const s = summarize(f.server[key])
          return s.n === 0
            ? 'n/a'
            : `${format(s.median, 'ms')} / ${format(s.p90, 'ms')}`
        })
        .join(' | ')} |`,
    )
  }
  out.push('', ...files.map((f) => `- ${fileLabel(f)}: ${f.server.note}`), '')
  out.push(
    '#### Measured on',
    '',
    ...files.map((f) => {
      const m = f.meta.machine
      const build = f.meta.build
        ? `, build ${f.meta.build.sha256.slice(0, 12)}${f.meta.build.skipped ? ' (--skip-build: not rebuilt for this run)' : ''}`
        : ''
      return (
        `- ${fileLabel(f)}: ${f.meta.date}, commit ${f.meta.commit.slice(0, 12)}` +
        `${f.meta.dirty ? ' (dirty)' : ''}${build}, harness ${(f.meta.harness as string | undefined)?.slice(0, 12) ?? 'not recorded'}, ${m.cpu}, ${m.cores} cores, ` +
        `${m.memoryGiB} GiB, ${m.platform} ${m.arch}, Playwright ${f.meta.playwright}, ` +
        f.profiles
          .map((p) => `${p.profile.browser} ${p.browserVersion}`)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', ')
      )
    }),
    '',
  )
  return out.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)
  const allowMismatch = argv.includes('--allow-mismatch')
  const paths = argv.filter((a) => a !== '--allow-mismatch')
  if (paths.length === 0) {
    console.error(
      'usage: npx tsx e2e/perf/table.ts <results.json> [...] [--allow-mismatch]',
    )
    process.exit(2)
  }
  const files = paths.map(
    (p) => JSON.parse(readFileSync(p, 'utf8')) as PerfFile,
  )
  console.log(markdownTables(files, { allowMismatch }))
}
