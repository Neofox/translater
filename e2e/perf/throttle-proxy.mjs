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
// downstream and one upstream queue:
//
// - every chunk waits for the link to be free, occupies it for size/rate,
//   then arrives one-way latency (RTT / 2) later; order is preserved;
// - a new connection pays one extra RTT before its first byte (TCP
//   handshake);
// - TARGET set: transparent mode, every connection is forwarded to TARGET
//   (fake mode: the browser opens http://127.0.0.1:<PORT>/ directly);
// - otherwise an HTTP CONNECT proxy (live mode: the browser's `proxy`
//   option), tunnelling TLS bytes through the same throttled link.
//
// Env: PORT, RTT_MS, DOWN_BPS, UP_BPS (bytes per second), TARGET=host:port.
import { connect, createServer } from 'node:net'

const PORT = Number(process.env.PORT)
const RTT = Number(process.env.RTT_MS)
const DOWN = Number(process.env.DOWN_BPS) / 1000 // bytes per ms
const UP = Number(process.env.UP_BPS) / 1000
const TARGET = process.env.TARGET ?? ''
if (!PORT || !(RTT >= 0) || !(DOWN > 0) || !(UP > 0))
  throw new Error('PORT, RTT_MS, DOWN_BPS and UP_BPS are required')

// About one TCP segment, so the first bytes of a response (its headers)
// arrive before the rest of a large body has crossed the link.
const PIECE = 1460

/** One direction of the shared link: a FIFO whose delivery times are
 * monotonic, served by a single timer. */
class Link {
  constructor(bytesPerMs, delayMs) {
    this.rate = bytesPerMs
    this.delay = delayMs
    this.free = 0
    this.queue = []
    this.timer = null
  }

  /** Queue `buf` (may be empty: a marker, e.g. end of stream) and call
   * `deliver` with each piece when it arrives at the far end. */
  send(buf, deliver, notBefore = 0) {
    const now = performance.now()
    const pieces = []
    for (let i = 0; i < buf.length; i += PIECE)
      pieces.push(buf.subarray(i, i + PIECE))
    if (pieces.length === 0) pieces.push(buf)
    for (const piece of pieces) {
      const start = Math.max(now, notBefore, this.free)
      this.free = start + piece.length / this.rate
      this.queue.push({ at: this.free + this.delay, piece, deliver })
    }
    this.arm()
  }

  arm() {
    if (this.timer !== null || this.queue.length === 0) return
    const wait = Math.max(0, this.queue[0].at - performance.now())
    this.timer = setTimeout(() => {
      this.timer = null
      const now = performance.now()
      while (this.queue.length > 0 && this.queue[0].at <= now + 0.5) {
        const { piece, deliver } = this.queue.shift()
        deliver(piece)
      }
      this.arm()
    }, wait)
  }
}

const up = new Link(UP, RTT / 2)
const down = new Link(DOWN, RTT / 2)

function parseConnect(buf) {
  const text = buf.toString('latin1')
  const end = text.indexOf('\r\n\r\n')
  if (end < 0) return null
  const match = /^CONNECT ([^\s:]+):(\d+) HTTP\/1\.[01]\r\n/.exec(text)
  if (!match) return { error: true }
  return { host: match[1], port: Number(match[2]), rest: buf.subarray(end + 4) }
}

createServer((client) => {
  client.setNoDelay(true)
  const handshakeUntil = performance.now() + RTT
  let target = null
  let pending = [] // client bytes that arrived before the target connected
  let head = Buffer.alloc(0) // CONNECT request being read
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    client.destroy()
    target?.destroy()
  }

  const toClient = (chunk) => {
    if (!closed) client.write(chunk)
  }

  const open = (host, port, reply) => {
    target = connect({ host, port })
    target.setNoDelay(true)
    target.on('connect', () => {
      if (reply) down.send(Buffer.from(reply), toClient)
      for (const chunk of pending) target.write(chunk)
      pending = null
    })
    target.on('data', (chunk) => down.send(chunk, toClient))
    target.on('end', () =>
      down.send(Buffer.alloc(0), () => {
        if (!closed) client.end()
      }),
    )
    target.on('error', close)
    target.on('close', () => down.send(Buffer.alloc(0), close))
  }

  const fromClient = (chunk) => {
    if (closed) return
    if (target === null && !TARGET) {
      head = Buffer.concat([head, chunk])
      const request = parseConnect(head)
      if (request === null) return
      if (request.error) {
        client.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n')
        return
      }
      if (request.rest.length) pending.push(request.rest)
      open(
        request.host,
        request.port,
        'HTTP/1.1 200 Connection Established\r\n\r\n',
      )
      return
    }
    if (target === null) {
      const [host, port] = TARGET.split(':')
      open(host, Number(port), null)
    }
    if (pending) pending.push(chunk)
    else target.write(chunk)
  }

  client.on('data', (chunk) => up.send(chunk, fromClient, handshakeUntil))
  client.on('end', () =>
    up.send(Buffer.alloc(0), () => target?.end(), handshakeUntil),
  )
  client.on('error', close)
  client.on('close', () => up.send(Buffer.alloc(0), close, handshakeUntil))
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`throttle proxy on ${PORT}\n`)
})
