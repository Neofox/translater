import { devices } from 'playwright'
import type { BrowserContextOptions } from 'playwright'

// Device profiles of the measurement protocol (spec "Measurement protocol",
// Task 5 brief). Shared by measure.ts and the table writer, which refuses to
// compare files whose profile definitions differ.
//
// Network throttling goes through e2e/perf/throttle-proxy.mjs for BOTH
// engines (one shared link: latency per request, +1 RTT per new connection,
// shared bandwidth), so the iPhone/WebKit profile gets the same network as
// the Pixel/Chromium one. CPU throttling exists only in Chromium (CDP
// Emulation.setCPUThrottlingRate); WebKit's CPU is unthrottled and the
// profile says so.

/** Lighthouse's mobile "slow 4G" throttling values: 150 ms RTT and
 * 1.6 Mbps down / 750 Kbps up, with its request-level multipliers (RTT x 3.75,
 * throughput x 0.9). */
export const LIGHTHOUSE_MOBILE_NETWORK = {
  rttMs: 150 * 3.75,
  downloadKbps: 1.6 * 1024 * 0.9,
  uploadKbps: 750 * 0.9,
} as const

export type NetworkThrottle = typeof LIGHTHOUSE_MOBILE_NETWORK

export type Profile = {
  id: string
  label: string
  browser: 'chromium' | 'webkit'
  context: BrowserContextOptions
  /** Chromium CDP `Emulation.setCPUThrottlingRate`; 1 = none. */
  cpuSlowdown: number
  /** Throttle proxy link; null = direct connection. */
  network: NetworkThrottle | null
  /** Run the simulated software-keyboard phases. */
  keyboard: boolean
}

function deviceContext(name: string): BrowserContextOptions {
  const { defaultBrowserType: _ignored, ...options } = devices[name]!
  return options
}

export const PROFILES: Profile[] = [
  {
    id: 'iphone-webkit-slow4g',
    label:
      'iPhone 15, WebKit, Lighthouse mobile network via the throttle proxy; CPU unthrottled (WebKit cannot be CPU-throttled)',
    browser: 'webkit',
    context: deviceContext('iPhone 15'),
    cpuSlowdown: 1,
    network: LIGHTHOUSE_MOBILE_NETWORK,
    keyboard: true,
  },
  {
    id: 'pixel-chromium-4xcpu-slow4g',
    label:
      'Pixel 7, Chromium, 4x CPU (CDP) + Lighthouse mobile network via the throttle proxy',
    browser: 'chromium',
    context: deviceContext('Pixel 7'),
    cpuSlowdown: 4,
    network: LIGHTHOUSE_MOBILE_NETWORK,
    keyboard: true,
  },
  {
    id: 'macbook-chromium',
    label:
      'MacBook 14" (1512x982 @2x), Chromium, unthrottled, direct connection',
    browser: 'chromium',
    context: {
      viewport: { width: 1512, height: 982 },
      deviceScaleFactor: 2,
      isMobile: false,
      hasTouch: false,
    },
    cpuSlowdown: 1,
    network: null,
    keyboard: false,
  },
]

/** What a results file records about a profile (enough to refuse comparing
 * different setups). */
export function profileDescription(profile: Profile) {
  return {
    id: profile.id,
    label: profile.label,
    browser: profile.browser,
    viewport: profile.context.viewport ?? null,
    deviceScaleFactor: profile.context.deviceScaleFactor ?? 1,
    isMobile: profile.context.isMobile ?? false,
    cpuSlowdown: profile.cpuSlowdown,
    network: profile.network,
    keyboard: profile.keyboard,
  }
}

export type ProfileDescription = ReturnType<typeof profileDescription>

/** Bytes per second of a throttle direction. */
export function bytesPerSecond(kbps: number): number {
  return (kbps * 1024) / 8
}
