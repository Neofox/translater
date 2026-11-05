// The --fake gateway: streams responses chunk by chunk, propagates client
// aborts, and blocks fonts for every app alike.
import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, Server } from 'node:http'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  GATEWAY_IDLE_TIMEOUT_MS,
  createGateway,
  isFontRequest,
} from './gateway.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise((done) => {
          s.closeAllConnections()
          s.close(done)
        }),
    ),
  )
})

function listen(server: Server): Promise<number> {
  servers.push(server)
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () =>
      done((server.address() as AddressInfo).port),
    ),
  )
}

function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<IncomingMessage> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, done)
    req.on('error', fail)
    req.end()
  })
}

describe('gateway', () => {
  it('recognises font requests by fetch destination or extension', () => {
    assert.equal(isFontRequest('/a.css', { 'sec-fetch-dest': 'font' }), true)
    assert.equal(isFontRequest('/static/x.woff2?v=1', {}), true)
    assert.equal(
      isFontRequest('/assets/app.js', { 'sec-fetch-dest': 'script' }),
      false,
    )
  })

  it('keeps idle browser connections open for longer than a measurement phase', () => {
    // Node's default (5 s, closing at ~6 s) let a connection die between
    // phases; the throttle proxy relays the close ~RTT/2 late, so WebKit
    // reused the dying connection and lost the request (no retry).
    const gateway = createGateway({ host: '127.0.0.1', port: 9 })
    assert.ok(
      GATEWAY_IDLE_TIMEOUT_MS >= 5 * 60_000,
      `GATEWAY_IDLE_TIMEOUT_MS >= 5 * 60_000`,
    )
    assert.equal(gateway.keepAliveTimeout, GATEWAY_IDLE_TIMEOUT_MS)
    assert.ok(
      gateway.headersTimeout > gateway.keepAliveTimeout,
      `gateway.headersTimeout > gateway.keepAliveTimeout`,
    )
  })

  it('streams chunks as they come, answers fonts with 404 and propagates aborts', async () => {
    let aborted = false
    const target = createServer((req, res) => {
      if (req.url === '/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: 1\n\n')
        const timer = setInterval(() => res.write('data: n\n\n'), 100)
        res.on('close', () => {
          clearInterval(timer)
          if (!res.writableEnded) aborted = true
        })
        return
      }
      res.end('ok')
    })
    const targetPort = await listen(target)
    const port = await listen(
      createGateway({ host: '127.0.0.1', port: targetPort }),
    )

    const font = await get(port, '/fonts/a.css', { 'sec-fetch-dest': 'font' })
    assert.equal(font.statusCode, 404)
    font.resume()

    const t0 = performance.now()
    const stream = await get(port, '/stream')
    const first = await new Promise<number>((done) =>
      stream.once('data', () => done(performance.now() - t0)),
    )
    assert.ok(first < 80, `first < 80`)
    stream.destroy()
    await new Promise((done) => setTimeout(done, 200))
    assert.equal(aborted, true)
  })
})
