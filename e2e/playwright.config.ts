import { defineConfig } from '@playwright/test'
import type { PlaywrightTestConfig } from '@playwright/test'
import {
  APP,
  TS_BUILD,
  WORKERS,
  appPort,
  appUrl,
  fakePort,
  fakeUrl,
} from './ports'

// Black-box parity suite: the same tests drive the TypeScript app (APP=ts,
// default) and the Go app (APP=go) through URLs, data-testid/ARIA selectors
// and the fake OpenAI server's /_stats. Nothing here may reach real OpenAI:
// every app server gets OPENAI_BASE_URL pointed at its own fake and a dummy
// key, and global-setup.ts refuses to run unless the fake sees the first
// translation.

// The nine profiles of vitest.browser.config.ts, in both engines.
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

// Environment for every app server. Explicit process env wins over the
// .env/.env.local files Nitro's dev server loads (c12 only overrides keys it
// sourced from dotenv itself), so the local OpenAI key is never used. Empty
// Langfuse keys keep telemetry off.
function appEnv(index: number): Record<string, string> {
  return {
    OPENAI_BASE_URL: `${fakeUrl(index)}/v1`,
    OPENAI_API_KEY: 'test',
    LANGFUSE_PUBLIC_KEY: '',
    LANGFUSE_SECRET_KEY: '',
    AI_GATEWAY_API_KEY: '',
  }
}

// App servers log every client console message; set E2E_SERVER_LOGS=1 to see them.
const appStderr = process.env.E2E_SERVER_LOGS ? 'pipe' : 'ignore'

type WebServer = NonNullable<PlaywrightTestConfig['webServer']>
const servers: Extract<WebServer, unknown[]> = []
for (let i = 0; i < WORKERS; i++) {
  servers.push({
    name: `fake-openai-${i}`,
    command: `go run ./cmd/fakeopenai -addr 127.0.0.1:${fakePort(i)} -fixtures ../e2e/fixtures/results`,
    cwd: '../go',
    url: `${fakeUrl(i)}/_stats`,
    // Never attach to a server started elsewhere: it could be a dev server
    // holding a real key.
    reuseExistingServer: false,
    timeout: 120_000,
  })
  servers.push(
    APP === 'ts' && TS_BUILD === 'prod'
      ? {
          // Web servers start one after another, so only the first builds;
          // the others serve the finished .vercel/output.
          name: `app-ts-prod-${i}`,
          command:
            i === 0
              ? 'npm run build && node e2e/perf/serve-ts.mjs'
              : 'node e2e/perf/serve-ts.mjs',
          cwd: '..',
          url: `${appUrl(i)}/`,
          env: { ...appEnv(i), PORT: String(appPort(i)) },
          stderr: appStderr,
          reuseExistingServer: false,
          timeout: i === 0 ? 600_000 : 60_000,
        }
      : APP === 'ts'
        ? {
            name: `app-ts-${i}`,
            command: `npm run dev -- --port ${appPort(i)} --strictPort`,
            cwd: '..',
            url: `http://localhost:${appPort(i)}/`,
            env: appEnv(i),
            stderr: appStderr,
            reuseExistingServer: false,
            timeout: 180_000,
          }
        : {
            name: `app-go-${i}`,
            command: 'go run .',
            cwd: '../go',
            // Port readiness only: global setup reports a clear error when the
            // Go app does not serve the translator page yet.
            port: appPort(i),
            env: { ...appEnv(i), PORT: String(appPort(i)) },
            stderr: appStderr,
            reuseExistingServer: false,
            timeout: 180_000,
          },
  )
}

export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results/e2e',
  // Visual parity baselines (tests/visual.spec.ts): one folder per project,
  // shared by both apps. The TS run writes them (e2e:visual passes
  // --update-snapshots=all); the Go run only compares, so a missing baseline
  // fails instead of being written.
  snapshotPathTemplate:
    '../test-results/visual-baseline/{projectName}/{arg}{ext}',
  updateSnapshots: APP === 'go' ? 'none' : 'missing',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  workers: WORKERS,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: '../test-results/e2e-report', open: 'never' }],
  ],
  use: {
    trace: 'retain-on-failure',
    locale: 'en-US',
    hasTouch: true,
  },
  webServer: servers,
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
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
  ),
})
