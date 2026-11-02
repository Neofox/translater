// Network throttling proxy for the measurement harness: one simulated access
// link (round-trip latency + downstream/upstream bandwidth) applied the same
// way to every request of every browser engine. Chromium's CDP network
// emulation cannot throttle WebKit and lets the navigation's own document
// through before its throttle applies, so both engines go through this proxy
// instead.
//
// Hand-written because the maintained options do not model a shared link:
// Toxiproxy's bandwidth/latency toxics and Node stream throttles limit each
// TCP connection separately (a browser opening six connections would get six
// times the bandwidth), and @sitespeed.io/throttle shapes the whole OS
// network through pfctl/tc with root. Here all connections share one
// downstream and one upstream link:
//
// - every 1460-byte segment waits for its link to be free, occupies it for
//   size / bandwidth, then arrives RTT / 2 later; order is preserved. The
//   link is FIFO by arrival (total bandwidth is shared; a response that
//   started earlier finishes earlier rather than flows interleaving fairly);
// - a new connection pays one extra RTT (TCP handshake) before its first
//   byte enters the upstream link; the wait is per connection and never
//   delays other connections' traffic;
// - `target` set: transparent mode, every connection is forwarded to it
//   (--fake: the browser opens http://127.0.0.1:<port>/ directly);
// - otherwise an HTTP CONNECT proxy (--live: the browser's `proxy` option).
//   The CONNECT request and its "200 Connection Established" are proxy
//   plumbing that a direct connection does not have, so they bypass the
//   link; only the tunnelled bytes (TLS and HTTP) are throttled.
//
// Run directly (Node strips the types):
//   PORT=… RTT_MS=… DOWN_BPS=… UP_BPS=… [TARGET=host:port] node e2e/perf/throttle-proxy.ts
import { connect, createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { pathToFileURL } from 'node:url'

/** About one TCP segment, so the first bytes of a response (its headers)
 * arrive before the rest of a large body has crossed the link. */
const SEGMENT = 1460

type Delivery = { at: number; piece: Buffer; deliver: (piece: Buffer) => void }

/** One direction of the shared link: a FIFO whose delivery times are
 * monotonic, served by a single timer. */
export class Link {
  readonly bytesPerMs: number
  readonly delayMs: number
  private free = 0
  private readonly queue: Delivery[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(bytesPerSecond: number, delayMs: number) {
    this.bytesPerMs = bytesPerSecond / 1000
    this.delayMs = delayMs
  }

  /** Queue `buf` (may be empty: an ordered marker such as end of stream) and
   * call `deliver` with each piece when it reaches the far end. */
  send(buf: Buffer, deliver: (piece: Buffer) => void): void {
    const now = performance.now()
    const pieces: Buffer[] = []
    for (let i = 0; i < buf.length; i += SEGMENT)
      pieces.push(buf.subarray(i, i + SEGMENT))
    if (pieces.length === 0) pieces.push(buf)
    for (const piece of pieces) {
      const start = Math.max(now, this.free)
      this.free = start + piece.length / this.bytesPerMs
      this.queue.push({ at: this.free + this.delayMs, piece, deliver })
    }
    this.arm()
  }

  private arm(): void {
    if (this.timer !== null || this.queue.length === 0) return
    const wait = Math.max(0, this.queue[0]!.at - performance.now())
    this.timer = setTimeout(() => {
      this.timer = null
      const now = performance.now()
      while (this.queue.length > 0 && this.queue[0]!.at <= now + 0.5) {
        const { piece, deliver } = this.queue.shift()!
        deliver(piece)
      }
      this.arm()
    }, wait)
  }
}

/** Holds one connection's actions until its handshake RTT has passed, in
 * order, without touching the shared link. */
class Gate {
  private pending: Array<() => void> | null = []

  constructor(until: number) {
    setTimeout(
      () => {
        const actions = this.pending ?? []
        this.pending = null
        for (const action of actions) action()
      },
      Math.max(0, until - performance.now()),
    )
  }

  run(action: () => void): void {
    if (this.pending) this.pending.push(action)
    else action()
  }
}

export type ThrottleOptions = {
  rttMs: number
  downBytesPerSecond: number
  upBytesPerSecond: number
  target: { host: string; port: number } | null
}

type ConnectRequest =
  { host: string; port: number; rest: Buffer } | { error: true } | null

function parseConnect(buf: Buffer): ConnectRequest {
  const text = buf.toString('latin1')
  const end = text.indexOf('\r\n\r\n')
  if (end < 0) return null
  const match = /^CONNECT ([^\s:]+):(\d+) HTTP\/1\.[01]\r\n/.exec(text)
  if (!match) return { error: true }
  return {
    host: match[1]!,
    port: Number(match[2]),
    rest: buf.subarray(end + 4),
  }
}

export function createThrottleProxy(options: ThrottleOptions): Server {
  const up = new Link(options.upBytesPerSecond, options.rttMs / 2)
  const down = new Link(options.downBytesPerSecond, options.rttMs / 2)

  return createServer((client: Socket) => {
    client.setNoDelay(true)
    const gate = new Gate(performance.now() + options.rttMs)
    let target: Socket | null = null
    let pending: Buffer[] | null = [] // bytes before the target connected
    let closed = false

    const close = () => {
      if (closed) return
      closed = true
      client.destroy()
      target?.destroy()
    }
    const toClient = (chunk: Buffer) => {
      if (!closed && chunk.length) client.write(chunk)
    }
    const toTarget = (chunk: Buffer) => {
      if (closed || chunk.length === 0) return
      if (pending) pending.push(chunk)
      else target!.write(chunk)
    }
    /** Client bytes: per-connection handshake wait, then the shared link. */
    const upstream = (chunk: Buffer, deliver: (piece: Buffer) => void) =>
      gate.run(() => up.send(chunk, deliver))

    const open = (host: string, port: number, onConnect?: () => void) => {
      const socket = connect({ host, port })
      target = socket
      socket.setNoDelay(true)
      socket.on('connect', () => {
        onConnect?.()
        for (const chunk of pending ?? []) socket.write(chunk)
        pending = null
      })
      socket.on('data', (chunk: Buffer) => down.send(chunk, toClient))
      socket.on('end', () =>
        down.send(Buffer.alloc(0), () => {
          if (!closed) client.end()
        }),
      )
      socket.on('error', close)
      socket.on('close', () => down.send(Buffer.alloc(0), close))
    }

    const relay = () => {
      client.on('data', (chunk: Buffer) => upstream(chunk, toTarget))
      client.on('end', () =>
        upstream(Buffer.alloc(0), () => {
          target?.end()
        }),
      )
      client.on('close', () => upstream(Buffer.alloc(0), close))
    }
    client.on('error', close)

    if (options.target) {
      open(options.target.host, options.target.port)
      relay()
      return
    }
    // CONNECT: read the request head unthrottled, answer directly.
    let head = Buffer.alloc(0)
    const onHead = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk])
      const request = parseConnect(head)
      if (request === null) return
      client.off('data', onHead)
      if ('error' in request) {
        client.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n')
        return
      }
      if (request.rest.length) upstream(request.rest, toTarget)
      open(request.host, request.port, () => {
        if (!closed) client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      })
      relay()
    }
    client.on('data', onHead)
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT)
  const rttMs = Number(process.env.RTT_MS)
  const downBytesPerSecond = Number(process.env.DOWN_BPS)
  const upBytesPerSecond = Number(process.env.UP_BPS)
  if (
    !port ||
    !(rttMs >= 0) ||
    !(downBytesPerSecond > 0) ||
    !(upBytesPerSecond > 0)
  )
    throw new Error('PORT, RTT_MS, DOWN_BPS and UP_BPS are required')
  const [host, targetPort] = (process.env.TARGET ?? '').split(':')
  createThrottleProxy({
    rttMs,
    downBytesPerSecond,
    upBytesPerSecond,
    target: host && targetPort ? { host, port: Number(targetPort) } : null,
  }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`throttle proxy on ${port}\n`)
  })
}
