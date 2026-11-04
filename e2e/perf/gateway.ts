// Local HTTP gateway in front of the measured app in --fake mode. It forwards
// every request byte-for-byte (no compression, no buffering: streamed
// responses such as the translation SSE pass through chunk by chunk, and a
// client abort is propagated to the app) except fonts, which it answers with
// 404 for every app alike. Fonts are blocked because one app loads them from a
// CDN (blocked as a third party) while the other may serve them same-origin;
// without this one would pay for web fonts and the other would not.
//
// A font request is recognised by `Sec-Fetch-Dest: font` (Chromium and
// WebKit send it) or a font file extension.
//
// Hand-written with node:http (about 40 lines): the proxy libraries
// (http-proxy and its forks) add WebSocket/rewrite machinery this does not
// need, and srvx/fetch-based forwarding would decode content encodings.
//
// Run directly (Node strips the types):
//   PORT=… TARGET=host:port node e2e/perf/gateway.ts
import { Agent, createServer, request } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import { pathToFileURL } from 'node:url'

const FONT_PATH = /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
])

export function isFontRequest(
  url: string,
  headers: IncomingHttpHeaders,
): boolean {
  return headers['sec-fetch-dest'] === 'font' || FONT_PATH.test(url)
}

function forwardable(raw: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < raw.length; i += 2)
    if (!HOP_BY_HOP.has(raw[i]!.toLowerCase())) out.push(raw[i]!, raw[i + 1]!)
  return out
}

/** Idle keep-alive for browser connections: longer than any gap between
 * measurement phases. With Node's default (5 s, closing at ~6 s) a browser
 * connection could die between phases; the throttle proxy relays that close
 * ~RTT/2 late, so WebKit reused the dying connection for the next request and
 * lost it (Chromium retries, WebKit does not). Production keeps connections
 * open far longer than 6 s, so this also matches what the apps get live. */
export const GATEWAY_IDLE_TIMEOUT_MS = 10 * 60_000

export function createGateway(target: { host: string; port: number }): Server {
  const agent = new Agent({ keepAlive: true })
  const server = createServer((req, res) => {
    if (isFontRequest(req.url ?? '', req.headers)) {
      res.writeHead(404, {
        'content-type': 'text/plain',
        'cache-control': 'no-store',
      })
      res.end('fonts are blocked in --fake measurements')
      return
    }
    const upstream = request(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: forwardable(req.rawHeaders),
        agent,
      },
      (response) => {
        res.writeHead(
          response.statusCode ?? 502,
          response.statusMessage,
          forwardable(response.rawHeaders),
        )
        res.flushHeaders()
        response.on('data', (chunk: Buffer) => res.write(chunk))
        response.on('end', () => res.end())
        response.on('error', () => res.destroy())
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.destroy()
    })
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })
    req.pipe(upstream)
  })
  server.keepAliveTimeout = GATEWAY_IDLE_TIMEOUT_MS
  // Must exceed keepAliveTimeout, or Node closes idle sockets at headersTimeout.
  server.headersTimeout = GATEWAY_IDLE_TIMEOUT_MS + 60_000
  return server
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT)
  const [host, targetPort] = (process.env.TARGET ?? '').split(':')
  if (!port || !host || !targetPort)
    throw new Error('PORT and TARGET=host:port are required')
  const server = createGateway({ host, port: Number(targetPort) })
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`gateway on ${port}\n`)
  })
}
