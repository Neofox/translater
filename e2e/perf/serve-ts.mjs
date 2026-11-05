// Serves the TypeScript app's production build (`npm run build`, Nitro's
// Vercel preset) locally for the measurement harness: the same
// `.vercel/output/functions/__server.func/index.mjs` fetch handler Vercel runs,
// plus `.vercel/output/static` for hashed assets. srvx is the Node server
// Nitro itself is built on, so this is the closest local stand-in for the
// Vercel function + CDN pair.
//
// Compression is OFF on purpose: the harness applies one policy to every app
// in --fake mode (uncompressed transfer, gzip size computed from the bodies),
// so neither app gets a local compression advantage. Production compression
// is only measured in --live mode.
//
// Usage: PORT=3150 node e2e/perf/serve-ts.mjs   (env carries OPENAI_BASE_URL)
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'

const root = resolve(import.meta.dirname, '../..')
const entry = resolve(root, '.vercel/output/functions/__server.func/index.mjs')
const handler = (await import(pathToFileURL(entry).href)).default

const port = Number(process.env.PORT)
if (!port) throw new Error('PORT is required')

const staticFiles = staticMiddleware({
  dir: resolve(root, '.vercel/output/static'),
  compress: false,
  encodings: false,
})

serve({
  port,
  hostname: '127.0.0.1',
  silent: true,
  // Vercel's route config sends /assets/** to the CDN with this header; the
  // filesystem is checked before falling back to the function.
  middleware: [
    async (req, next) => {
      const res = await staticFiles(req, next)
      if (new URL(req.url).pathname.startsWith('/assets/'))
        res.headers.set('cache-control', 'public, max-age=31536000, immutable')
      return res
    },
  ],
  fetch: (req) => handler.fetch(req, {}),
})
