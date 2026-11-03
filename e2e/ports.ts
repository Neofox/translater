// One fake OpenAI server + one app server per Playwright worker. The fake's
// /_stats counters are process-global and the app reads OPENAI_BASE_URL once
// at start, so parallel workers each need their own pair; tests pick theirs by
// `testInfo.parallelIndex`.

export type AppKind = 'ts' | 'go'

export const APP: AppKind = process.env.APP === 'go' ? 'go' : 'ts'

/** How the TS app is served: `vite dev` (default) or, with
 * E2E_TS_BUILD=prod, its production build through e2e/perf/serve-ts.mjs, so
 * dev overlays and devtools cannot appear in screenshots (e2e:visual). */
export const TS_BUILD: 'dev' | 'prod' =
  process.env.E2E_TS_BUILD === 'prod' ? 'prod' : 'dev'

export const WORKERS = Math.max(1, Number(process.env.E2E_WORKERS ?? 3) || 1)

const FAKE_BASE_PORT = 3901
const APP_BASE_PORT: Record<AppKind, number> = { ts: 3100, go: 3200 }

export function fakePort(index: number): number {
  return FAKE_BASE_PORT + index
}

export function appPort(index: number): number {
  return APP_BASE_PORT[APP] + index
}

export function fakeUrl(index: number): string {
  return `http://127.0.0.1:${fakePort(index)}`
}

export function appUrl(index: number): string {
  // serve-ts.mjs listens on 127.0.0.1 only.
  const host = APP === 'ts' && TS_BUILD === 'prod' ? '127.0.0.1' : 'localhost'
  return `http://${host}:${appPort(index)}`
}
