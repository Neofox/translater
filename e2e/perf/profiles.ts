import { devices } from 'playwright'
import type { BrowserContextOptions } from 'playwright'

// Device profiles of the measurement protocol (spec "Measurement protocol",
// Task 5 brief). Shared by measure.ts and the table writer, which refuses to
// compare files whose profile definitions differ.
//
// Deviation from the brief's "iPhone WebKit 3G-fast throttled": Playwright's
// WebKit has no CDP, so neither network nor CPU can be throttled there. The
// iPhone profile is measured UNTHROTTLED and named so; the throttled-network
// mobile case is carried by the Pixel profile (Lighthouse mobile throttling).

/** Lighthouse's "mobile slow 4G" DevTools throttling (the old "fast 3G"
 * numbers): 150 ms RTT and 1.6 Mbps down / 750 Kbps up, with Lighthouse's
 * request-level multipliers (RTT x 3.75, throughput x 0.9). */
export const LIGHTHOUSE_MOBILE_NETWORK = {
  latencyMs: 150 * 3.75,
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
  /** Chromium CDP `Network.emulateNetworkConditions`; null = none. */
  network: NetworkThrottle | null
  /** Run the simulated software-keyboard (visualViewport shrink) phase. */
  keyboard: boolean
}

function deviceContext(name: string): BrowserContextOptions {
  const { defaultBrowserType: _ignored, ...options } = devices[name]!
  return options
}

export const PROFILES: Profile[] = [
  {
    id: 'iphone-webkit-unthrottled',
    label: 'iPhone 15, WebKit, unthrottled (WebKit cannot be throttled)',
    browser: 'webkit',
    context: deviceContext('iPhone 15'),
    cpuSlowdown: 1,
    network: null,
    keyboard: true,
  },
  {
    id: 'pixel-chromium-4xcpu-slow4g',
    label: 'Pixel 7, Chromium, 4x CPU + Lighthouse mobile network',
    browser: 'chromium',
    context: deviceContext('Pixel 7'),
    cpuSlowdown: 4,
    network: LIGHTHOUSE_MOBILE_NETWORK,
    keyboard: true,
  },
  {
    id: 'macbook-chromium',
    label: 'MacBook 14" (1512x982 @2x), Chromium, unthrottled',
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
