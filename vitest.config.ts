import { configDefaults, defineConfig } from 'vitest/config'

// Keep unit tests independent from the application-only Nitro, TanStack Start,
// and devtools plugins. Loading the full Vite app config during Vitest leaves a
// module runner alive and produces a misleading shutdown timeout after success.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  // e2e/tests holds the Playwright parity suite (npm run e2e); go/ holds the
  // Go app, whose client modules use node:test (node --test).
  test: { exclude: [...configDefaults.exclude, 'e2e/tests/**', 'go/**'] },
})
