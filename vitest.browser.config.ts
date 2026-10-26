import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'

const viewports = [
  { label: 'portrait', width: 382, height: 580 },
  { label: 'landscape', width: 594, height: 368 },
  { label: 'unfolded-portrait', width: 594, height: 736 },
  { label: 'unfolded-landscape', width: 736, height: 594 },
  { label: 'macbook-14', width: 1512, height: 982 },
  { label: 'macbook-16', width: 1728, height: 1117 },
  { label: 'desktop-short', width: 1488, height: 700 },
] as const

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'react/jsx-runtime',
      'lucide-react',
      '@floating-ui/react',
      'zod',
    ],
  },
  resolve: {
    tsconfigPaths: true,
    // Keep TanStack's generated server entrypoints out of the component runner
    // and make a paid speech request impossible even before module mocks load.
    alias: [
      {
        find: '@tanstack/react-start',
        replacement: fileURLToPath(
          new URL('./tests/browser/serverFn.ts', import.meta.url),
        ),
      },
      ...['../server/speech', '../../src/server/speech'].map((find) => ({
        find,
        replacement: fileURLToPath(
          new URL('./tests/browser/speechTransport.ts', import.meta.url),
        ),
      })),
      ...[
        '../context/TranslatorContext',
        '../../src/context/TranslatorContext',
      ].map((find) => ({
        find,
        replacement: fileURLToPath(
          new URL('./tests/browser/translatorContext.ts', import.meta.url),
        ),
      })),
    ],
  },
  test: {
    // Provider trace chunks use test titles as temporary filenames. Running
    // this matrix sequentially keeps those artifacts separate and reproducible.
    maxWorkers: 1,
    include: ['tests/browser/**/*.browser.tsx'],
    setupFiles: ['tests/browser/setup.ts'],
    reporters: ['default', ['html', { outputDir: 'test-results/browser' }]],
    browser: {
      enabled: true,
      headless: true,
      ui: false,
      traceView: true,
      trace: {
        mode: 'retain-on-failure',
        tracesDir: 'test-results/browser/playwright',
      },
      screenshotDirectory: 'test-results/browser/screenshots',
      instances: (['chromium', 'webkit'] as const).flatMap((browser) =>
        viewports.map(({ label, width, height }) => ({
          browser,
          name: `${browser}-${label}`,
          viewport: { width, height },
          provider: playwright({
            contextOptions: {
              reducedMotion:
                browser === 'webkit' && label === 'portrait'
                  ? 'reduce'
                  : 'no-preference',
              locale: 'en-US',
              hasTouch: true,
            },
          }),
        })),
      ),
    },
  },
})
