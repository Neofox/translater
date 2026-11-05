import { defineConfig } from '@playwright/test'
import type { PlaywrightTestConfig } from '@playwright/test'
import { WORKERS, appPort, fakePort, fakeUrl } from './ports'

// Black-box suite: the tests drive the app through URLs, data-testid/ARIA
// selectors and the fake OpenAI server's /_stats. Nothing here may reach real
// OpenAI: every app server gets OPENAI_BASE_URL pointed at its own fake and a
// dummy key, and global-setup.ts refuses to run unless the fake sees the
// first translation.

// Nine folded/unfolded phone, iPhone and MacBook profiles, in both engines.
const viewports = [
  { label: 'portrait', width: 382, height: 580 },
  { label: 'landscape', width: 580, height: 382 },
  { label: 'unfolded-portrait', width: 594, height: 736 },
  { label: 'unfolded-landscape', width: 736, height: 594 },
  { label: 'macbook-14', width: 1512, height: 982 },
  { label: 'macbook-16', width: 1728, height: 1117 },
  { label: 'desktop-short', width: 1488, height: 700 },
  { label: 'iphone-portrait', width: 390, height: 844 },
  { label: 'iphone-landscape', width: 844, height: 390 },
] as const

// Environment for every app server: the app reads only the process
// environment, so the local OpenAI key is never used. Empty Langfuse keys
// keep telemetry off.
function appEnv(index: number): Record<string, string> {
  return {
    OPENAI_BASE_URL: `${fakeUrl(index)}/v1`,
    OPENAI_API_KEY: 'test',
    LANGFUSE_PUBLIC_KEY: '',
    LANGFUSE_SECRET_KEY: '',
  }
}

// App servers log every client console message; set E2E_SERVER_LOGS=1 to see them.
const appStderr = process.env.E2E_SERVER_LOGS ? 'pipe' : 'ignore'

type WebServer = NonNullable<PlaywrightTestConfig['webServer']>
const servers: Extract<WebServer, unknown[]> = []
for (let i = 0; i < WORKERS; i++) {
  servers.push({
    name: `fake-openai-${i}`,
    command: `go run ./cmd/fakeopenai -addr 127.0.0.1:${fakePort(i)} -fixtures e2e/fixtures/results`,
    cwd: '..',
    url: `${fakeUrl(i)}/_stats`,
    // Never attach to a server started elsewhere: it could be a dev server
    // holding a real key.
    reuseExistingServer: false,
    timeout: 120_000,
  })
  servers.push({
    name: `app-${i}`,
    command: 'go run .',
    cwd: '..',
    // Port readiness only: global setup reports a clear error when the app
    // does not serve the translator page yet.
    port: appPort(i),
    env: { ...appEnv(i), PORT: String(appPort(i)) },
    stderr: appStderr,
    reuseExistingServer: false,
    timeout: 180_000,
  })
}

// Production smoke (tests/prod-smoke.spec.ts, @prod): PROD_URL points the
// run at a deployment instead. Then no fake, no local app servers and no
// isolation check start, only @prod tests run (one project, one worker, no
// traces, which would record the bypass header), and every other run
// excludes @prod.
const PROD_URL = process.env.PROD_URL?.replace(/\/+$/, '')

export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results/e2e',
  // Visual regression baselines (tests/visual.spec.ts): one folder per
  // project, never committed (they depend on the machine's fonts). Only
  // `npm run e2e:visual:update` writes them (--update-snapshots=all); every
  // other run compares, so a missing baseline fails instead of being written.
  snapshotPathTemplate:
    '../test-results/visual-baseline/{projectName}/{arg}{ext}',
  updateSnapshots: 'none',
  globalSetup: PROD_URL ? undefined : './global-setup.ts',
  // The visual tests run only through `npm run e2e:visual[:update]`
  // (e2e/visual/run.mjs sets E2E_VISUAL); plain e2e runs skip them. The
  // billed @prod smoke runs only with PROD_URL.
  grep: PROD_URL ? /@prod/ : undefined,
  grepInvert: [
    ...(process.env.E2E_VISUAL ? [] : [/@visual/]),
    ...(PROD_URL ? [] : [/@prod/]),
  ],
  fullyParallel: true,
  workers: PROD_URL ? 1 : WORKERS,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: '../test-results/e2e-report', open: 'never' }],
  ],
  use: {
    trace: PROD_URL ? 'off' : 'retain-on-failure',
    locale: 'en-US',
    hasTouch: true,
    ...(PROD_URL && { baseURL: PROD_URL }),
  },
  webServer: PROD_URL ? undefined : servers,
  projects: (['chromium', 'webkit'] as const)
    .flatMap((browserName) =>
      viewports.map(({ label, width, height }) => ({
        name: `${browserName}-${label}`,
        use: {
          browserName,
          viewport: { width, height },
          reducedMotion:
            browserName === 'webkit' && label === 'portrait'
              ? ('reduce' as const)
              : ('no-preference' as const),
          // Chromium grants both clipboard permissions. WebKit only knows
          // `clipboard-read`; with it, writeText/readText work after a user
          // gesture inside its own (non-system) pasteboard.
          permissions:
            browserName === 'chromium'
              ? ['clipboard-read', 'clipboard-write']
              : ['clipboard-read'],
        },
      })),
    )
    // Each @prod test is billed: one project, so a run without --project
    // still makes exactly one translation and one speech request.
    .filter(({ name }) => !PROD_URL || name === 'chromium-macbook-14'),
})
