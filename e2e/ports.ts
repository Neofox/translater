// One fake OpenAI server + one app server per Playwright worker. The fake's
// /_stats counters are process-global and the app reads OPENAI_BASE_URL once
// at start, so parallel workers each need their own pair; tests pick theirs by
// `testInfo.parallelIndex`.

export const WORKERS = Math.max(1, Number(process.env.E2E_WORKERS ?? 3) || 1)

// E2E_PORT_OFFSET shifts every port, so two suites can run at once (e.g.
// two worktrees, or two agents in one): offsets at least E2E_WORKERS apart
// never collide. The bases are 2000 apart so an offset in the app's band
// cannot land on the fake's ports.
const OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0) || 0
const FAKE_BASE_PORT = 7101 + OFFSET
const APP_BASE_PORT = 5101 + OFFSET

export function fakePort(index: number): number {
  return FAKE_BASE_PORT + index
}

export function appPort(index: number): number {
  return APP_BASE_PORT + index
}

export function fakeUrl(index: number): string {
  return `http://127.0.0.1:${fakePort(index)}`
}

export function appUrl(index: number): string {
  return `http://localhost:${appPort(index)}`
}
