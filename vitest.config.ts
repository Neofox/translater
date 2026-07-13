import { defineConfig } from 'vitest/config'

// Keep unit tests independent from the application-only Nitro, TanStack Start,
// and devtools plugins. Loading the full Vite app config during Vitest leaves a
// module runner alive and produces a misleading shutdown timeout after success.
export default defineConfig({
  resolve: { tsconfigPaths: true },
})
