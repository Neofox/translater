// Ports of src/lib/pcmPlayer.test.ts. Web Audio does not run in Node: this
// boundary records sample buffers and scheduling while the real decoder and
// completion logic run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_AUDIO_BYTES, PcmPlayer } from './pcm.js'

function audioHarness() {
  const sources = []
  const calls = { close: 0 }
  const context = {
    currentTime: 1,
    destination: {},
    resume: () => Promise.resolve(),
    close() {
      calls.close++
      return Promise.resolve()
    },
    createBuffer: (_channels, length, rate) => {
      const samples = new Float32Array(length)
      return { duration: length / rate, samples, getChannelData: () => samples }
    },
    createBufferSource() {
      const source = {
        buffer: null,
        onended: null,
        starts: [],
        stops: 0,
        disconnects: 0,
        connect() {},
        start(time) {
          this.starts.push(time)
        },
        stop() {
          this.stops++
        },
        disconnect() {
          this.disconnects++
        },
      }
      sources.push(source)
      return source
    },
  }
  return { context, sources, calls, player: () => new PcmPlayer(context) }
}

test('joins odd byte boundaries and decodes signed little-endian samples', () => {
  const { player, sources } = audioHarness()
  const pcm = player()
  pcm.append(new Uint8Array([0, 128, 255]), 24000)
  pcm.append(new Uint8Array([127, 0, 0]), 24000)
  assert.deepEqual(Array.from(sources[0].buffer.samples), [-1])
  assert.deepEqual(Array.from(sources[1].buffer.samples), [Math.fround(32767 / 32768), 0])
  assert.ok(Math.abs(sources[1].starts[0] - (1.02 + 1 / 24000)) < 1e-9)
})

test('finishes only after the final scheduled audio ends', async () => {
  const { player, sources } = audioHarness()
  const pcm = player()
  pcm.append(new Uint8Array([0, 0]), 24000)
  let ended = false
  const completion = pcm.endInput().then(() => {
    ended = true
  })
  await Promise.resolve()
  assert.equal(ended, false)
  sources[0].onended()
  await completion
  assert.equal(ended, true)
})

test('stops queued sources, closes audio, and unblocks completion', async () => {
  const { player, sources, calls } = audioHarness()
  const pcm = player()
  pcm.append(new Uint8Array([0, 0]), 24000)
  const completion = pcm.endInput()
  pcm.stop()
  await completion
  assert.equal(sources[0].stops, 1)
  assert.equal(sources[0].disconnects, 1)
  assert.equal(calls.close, 1)
})

test('rejects truncated frames, empty output, changed formats, and oversized audio', () => {
  const odd = audioHarness().player()
  odd.append(new Uint8Array([1]), 24000)
  assert.throws(() => odd.endInput())
  assert.throws(() => audioHarness().player().endInput())
  const changed = audioHarness().player()
  changed.append(new Uint8Array([0, 0]), 24000)
  assert.throws(() => changed.append(new Uint8Array([0, 0]), 48000))
  for (const rate of [7999, 96001, 24000.5])
    assert.throws(() => audioHarness().player().append(new Uint8Array([0, 0]), rate))
  assert.equal(audioHarness().player().append(new Uint8Array([0, 0]), 96000), true)
  assert.throws(() => audioHarness().player().append(new Uint8Array(MAX_AUDIO_BYTES + 1), 24000))
  const stopped = audioHarness().player()
  stopped.stop()
  assert.throws(() => stopped.append(new Uint8Array([0, 0]), 24000))
})
