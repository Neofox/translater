// Scheduling of the measurement harness's throttle proxy: per-connection
// handshake waits must not delay other connections, CONNECT plumbing must not
// cost simulated round trips, and bandwidth is shared between connections.
import { connect, createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createThrottleProxy } from './throttle-proxy.ts'

const RTT = 200

const servers: Server[] = []
const sockets: Socket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy()
  await Promise.all(
    servers.splice(0).map((s) => new Promise((done) => s.close(done))),
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

/** Echoes each chunk; "big:<n>" answers n bytes. */
function targetServer(): Server {
  return createServer((socket) => {
    socket.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const big = /^big:(\d+)$/.exec(text)
      socket.write(big ? Buffer.alloc(Number(big[1]), 120) : chunk)
    })
    socket.on('error', () => {})
  })
}

function open(port: number): Promise<Socket> {
  return new Promise((done, fail) => {
    const socket = connect({ port, host: '127.0.0.1' }, () => done(socket))
    socket.setNoDelay(true)
    socket.on('error', fail)
    sockets.push(socket)
  })
}

/** Writes `message` and resolves with the ms until `bytes` came back. */
function roundTrip(socket: Socket, message: string, bytes: number) {
  return new Promise<number>((done) => {
    const t0 = performance.now()
    let received = 0
    const onData = (chunk: Buffer) => {
      received += chunk.length
      if (received >= bytes) {
        socket.off('data', onData)
        done(performance.now() - t0)
      }
    }
    socket.on('data', onData)
    socket.write(message)
  })
}

async function proxy(options: {
  down?: number
  target: boolean
}): Promise<{ proxyPort: number; targetPort: number }> {
  const targetPort = await listen(targetServer())
  const proxyPort = await listen(
    createThrottleProxy({
      rttMs: RTT,
      downBytesPerSecond: options.down ?? 1e9,
      upBytesPerSecond: 1e9,
      target: options.target ? { host: '127.0.0.1', port: targetPort } : null,
    }),
  )
  return { proxyPort, targetPort }
}

describe('throttle proxy', () => {
  it('charges a new connection one handshake RTT, then one RTT per exchange', async () => {
    const { proxyPort } = await proxy({ target: true })
    const a = await open(proxyPort)
    const first = await roundTrip(a, 'one', 3)
    assert.ok(first >= 2 * RTT - 5, `first >= 2 * RTT - 5`)
    assert.ok(first < 2 * RTT + 80, `first < 2 * RTT + 80`)
    const second = await roundTrip(a, 'two', 3)
    assert.ok(second >= RTT - 5, `second >= RTT - 5`)
    assert.ok(second < RTT + 80, `second < RTT + 80`)
  })

  it('never delays an open connection while another one is handshaking', async () => {
    const { proxyPort } = await proxy({ target: true })
    const a = await open(proxyPort)
    await roundTrip(a, 'warm', 4)
    // b connects and writes FIRST, so its bytes are queued while its
    // handshake RTT runs; only then does a send on its open connection.
    // A scheduler that books b's handshake on the shared upload link (the
    // round-1 bug) makes a wait for b's handshake: a then takes ~2 RTT. Run
    // against that scheduler this test failed with timeA ~ 380 ms (see the
    // Task 5 report, fix round 3).
    const b = await open(proxyPort)
    const timeB = roundTrip(b, 'from-b', 6)
    await new Promise((done) => setTimeout(done, 20))
    const timeA = await roundTrip(a, 'from-a', 6)
    assert.ok(timeA < RTT + 80, `timeA < RTT + 80`)
    assert.ok((await timeB) >= 2 * RTT - 5, `await timeB >= 2 * RTT - 5`)
  })

  it('answers CONNECT directly and throttles only the tunnelled bytes', async () => {
    const { proxyPort, targetPort } = await proxy({ target: false })
    const socket = await open(proxyPort)
    const established = await new Promise<number>((done) => {
      const t0 = performance.now()
      socket.once('data', (chunk: Buffer) => {
        assert.equal(
          chunk.toString(),
          'HTTP/1.1 200 Connection Established\r\n\r\n',
        )
        done(performance.now() - t0)
      })
      socket.write(
        `CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`,
      )
    })
    assert.ok(established < 50, `established < 50`)
    // First tunnelled exchange: the rest of the handshake RTT + one RTT.
    const first = await roundTrip(socket, 'hello', 5)
    assert.ok(first < 2 * RTT + 80, `first < 2 * RTT + 80`)
    assert.ok(first >= 2 * RTT - 60, `first >= 2 * RTT - 60`)
    const second = await roundTrip(socket, 'again', 5)
    assert.ok(second >= RTT - 5, `second >= RTT - 5`)
    assert.ok(second < RTT + 80, `second < RTT + 80`)
  })

  it('shares downstream bandwidth between connections', async () => {
    // 100 kB/s: 10 kB alone takes 100 ms of link time; two responses at
    // once share the link, so the later one completes after 200 ms (the link
    // is FIFO by arrival, not per-flow fair: the total is what is shared).
    const { proxyPort } = await proxy({ target: true, down: 100_000 })
    const a = await open(proxyPort)
    const b = await open(proxyPort)
    await Promise.all([roundTrip(a, 'w', 1), roundTrip(b, 'w', 1)])
    const alone = await roundTrip(a, 'big:10000', 10_000)
    const both = Math.max(
      ...(await Promise.all([
        roundTrip(a, 'big:10000', 10_000),
        roundTrip(b, 'big:10000', 10_000),
      ])),
    )
    assert.ok(alone - RTT >= 90, `alone - RTT >= 90`)
    assert.ok(alone - RTT < 160, `alone - RTT < 160`)
    assert.ok(both - RTT >= 190, `both - RTT >= 190`)
    assert.ok(both - RTT < 270, `both - RTT < 270`)
  })
})
