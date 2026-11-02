// Results format of e2e/perf/measure.ts and the markdown table writer used by
// the baseline (Task 5) and the TS vs Go comparison (Task 13).
//
//   npx tsx e2e/perf/table.ts ts.json [go.json ...]
//
// Statistics are inline (median + nearest-rank p90 over at most tens of
// samples); no library needed for two order statistics.
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import type { ProfileDescription } from './profiles'

/** One page-load run: fresh browser context, no interaction. */
export type LoadRun = {
  ttfb: number | null
  fcp: number | null
  lcp: number | null
  tbt: number | null
  domContentLoaded: number | null
  load: number | null
  loadCls: number | null
  jsRaw: number
  jsTransferred: number
  jsGzip: number
  cssRaw: number
  cssTransferred: number
  cssGzip: number
  htmlRaw: number
  htmlTransferred: number
  totalTransferred: number
  resources: Array<{
    url: string
    type: string
    status: number
    encoding: string | null
    raw: number
    transferred: number | null
    gzip: number | null
  }>
}

/** One interaction run: fresh context; first-typeable during load, then one
 * translation, then (mobile) the simulated keyboard. */
export type InteractRun = {
  /** Earliest keystroke whose character is still in the field afterwards. */
  firstTypeable: number | null
  /** Earliest keystroke the field showed at all (it may be lost later, e.g.
   * when hydration resets a pre-hydration value). */
  firstInput: number | null
  typeableAttempts: number
  keyToFirstChar: number | null
  keyToCopy: number | null
  keyToDone: number | null
  upstreamRequests: number | null
  keyboardCls: number | null
  keyboardMainDy: number | null
  keyboardSourceDy: number | null
}

export type ProfileResult = {
  profile: ProfileDescription
  browserVersion: string
  supportedEntryTypes: string[]
  load: Array<LoadRun | { error: string }>
  interact: Array<InteractRun | { error: string }>
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
    playwright: string
    text: string
    debounce: string
    compression: string
    notes: string[]
  }
  server: {
    note: string
    coldTtfb: number[]
    warmTtfb: number[]
  }
  profiles: ProfileResult[]
}

// ----- statistics --------------------------------------------------------------

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

// ----- metrics -------------------------------------------------------------------

type Unit = 'ms' | 'bytes' | 'score' | 'px'

type Metric<TRun> = {
  key: keyof TRun & string
  label: string
  unit: Unit
}

export const LOAD_METRICS: Metric<LoadRun>[] = [
  { key: 'ttfb', label: 'TTFB', unit: 'ms' },
  { key: 'fcp', label: 'FCP', unit: 'ms' },
  { key: 'lcp', label: 'LCP', unit: 'ms' },
  { key: 'tbt', label: 'TBT (FCP to quiet)', unit: 'ms' },
  { key: 'domContentLoaded', label: 'DOMContentLoaded', unit: 'ms' },
  { key: 'load', label: 'load event', unit: 'ms' },
  { key: 'loadCls', label: 'CLS during load', unit: 'score' },
  { key: 'jsRaw', label: 'JS raw (decoded)', unit: 'bytes' },
  { key: 'jsTransferred', label: 'JS transferred', unit: 'bytes' },
  { key: 'jsGzip', label: 'JS gzip -9 (computed)', unit: 'bytes' },
  { key: 'cssRaw', label: 'CSS raw (decoded)', unit: 'bytes' },
  { key: 'cssTransferred', label: 'CSS transferred', unit: 'bytes' },
  { key: 'cssGzip', label: 'CSS gzip -9 (computed)', unit: 'bytes' },
  { key: 'htmlRaw', label: 'HTML raw (decoded)', unit: 'bytes' },
  { key: 'totalTransferred', label: 'All transferred', unit: 'bytes' },
]

export const INTERACT_METRICS: Metric<InteractRun>[] = [
  {
    key: 'firstTypeable',
    label: 'First typeable (keystroke kept)',
    unit: 'ms',
  },
  {
    key: 'firstInput',
    label: 'First keystroke shown (may be lost)',
    unit: 'ms',
  },
  {
    key: 'keyToFirstChar',
    label: 'Last key to first main char',
    unit: 'ms',
  },
  { key: 'keyToCopy', label: 'Last key to Copy enabled', unit: 'ms' },
  { key: 'keyToDone', label: 'Last key to done', unit: 'ms' },
  { key: 'keyboardCls', label: 'Keyboard open: CLS', unit: 'score' },
  { key: 'keyboardMainDy', label: 'Keyboard open: main text dy', unit: 'px' },
  {
    key: 'keyboardSourceDy',
    label: 'Keyboard open: source textarea dy',
    unit: 'px',
  },
]

function ok<TRun extends object>(
  runs: Array<TRun | { error: string }>,
): TRun[] {
  return runs.filter((r): r is TRun => !('error' in r))
}

function samples<TRun>(runs: TRun[], key: keyof TRun): number[] {
  return runs
    .map((r) => r[key])
    .filter((v): v is TRun[keyof TRun] & number => typeof v === 'number')
}

export type Summary = { median: number | null; p90: number | null; n: number }

export function summarize(values: number[]): Summary {
  return {
    median: median(values),
    p90: percentile(values, 90),
    n: values.length,
  }
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
    case 'bytes':
      return value >= 10_000
        ? `${(value / 1024).toFixed(1)} KiB`
        : `${Math.round(value)} B`
  }
}

function cell(s: Summary, unit: Unit, runs: number): string {
  if (s.n === 0) return 'n/a'
  const missing = s.n < runs ? ` (n=${s.n})` : ''
  return `${format(s.median, unit)} / ${format(s.p90, unit)}${missing}`
}

function fileLabel(file: PerfFile): string {
  return `${file.meta.app} (${file.meta.mode})`
}

/** Refuse to put files measured under different profile definitions side by
 * side. */
function assertComparable(files: PerfFile[]): void {
  const [first, ...rest] = files
  for (const other of rest) {
    for (const p of other.profiles) {
      const match = first!.profiles.find((q) => q.profile.id === p.profile.id)
      if (match && !isDeepStrictEqual(match.profile, p.profile))
        throw new Error(
          `profile ${p.profile.id} differs between ${fileLabel(first!)} and ` +
            `${fileLabel(other)}; re-measure with the same profiles.ts`,
        )
    }
  }
}

/** Markdown: one table per profile, a column per file, each cell
 * "median / p90". Also the server cold/warm TTFB table. */
export function markdownTables(files: PerfFile[]): string {
  if (files.length === 0) throw new Error('no results files')
  assertComparable(files)
  const out: string[] = []
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
    out.push(`#### ${id}`, '', any.profile.label, '', header, rule)
    for (const m of LOAD_METRICS) {
      const cells = files.map((f, i) => {
        const r = results[i]
        return r
          ? cell(summarize(samples(ok(r.load), m.key)), m.unit, f.meta.runs)
          : '-'
      })
      out.push(`| ${m.label} | ${cells.join(' | ')} |`)
    }
    for (const m of INTERACT_METRICS) {
      if (m.key.startsWith('keyboard') && !any.profile.keyboard) continue
      const cells = files.map((f, i) => {
        const r = results[i]
        return r
          ? cell(summarize(samples(ok(r.interact), m.key)), m.unit, f.meta.runs)
          : '-'
      })
      out.push(`| ${m.label} | ${cells.join(' | ')} |`)
    }
    const errors = results.flatMap((r, i) =>
      r
        ? [...r.load, ...r.interact]
            .filter((x): x is { error: string } => 'error' in x)
            .map((x) => `${fileLabel(files[i]!)}: ${x.error}`)
        : [],
    )
    out.push('')
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
        .map((f) => cell(summarize(f.server[key]), 'ms', f.server[key].length))
        .join(' | ')} |`,
    )
  }
  out.push('', ...files.map((f) => `- ${fileLabel(f)}: ${f.server.note}`), '')
  return out.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.error('usage: npx tsx e2e/perf/table.ts <results.json> [...]')
    process.exit(2)
  }
  const files = paths.map(
    (p) => JSON.parse(readFileSync(p, 'utf8')) as PerfFile,
  )
  console.log(markdownTables(files))
}
