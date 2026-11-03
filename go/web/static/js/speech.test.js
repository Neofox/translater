import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CACHE_BYTES, createReplayCache, loadAudio, parseRate, replayKey, speechLanguage } from './speech.js'

const audio = (bytes) => ({ chunks: [new Uint8Array(0)], bytes, rate: 24000 })

test('replay cache keeps at most three entries, evicting the least recently used', () => {
  const cache = createReplayCache()
  for (let i = 0; i < 3; i++) cache.set(replayKey(`t${i}`, 'en'), audio(2))
  // A hit refreshes the entry: t1 is now the oldest.
  assert.ok(cache.get(replayKey('t0', 'en')))
  cache.set(replayKey('t3', 'en'), audio(2))
  assert.equal(cache.size, 3)
  assert.equal(cache.get(replayKey('t1', 'en')), undefined)
  for (const t of ['t0', 't2', 't3']) assert.ok(cache.get(replayKey(t, 'en')), t)
  assert.equal(cache.bytes, 6)
})

test('replay cache stays within 4 MiB and never keeps a larger entry', () => {
  const cache = createReplayCache()
  const big = 3 * 1024 * 1024
  cache.set('a', audio(big))
  cache.set('b', audio(big))
  assert.equal(cache.get('a'), undefined)
  assert.ok(cache.get('b'))
  assert.equal(cache.bytes, big)
  cache.set('c', audio(MAX_CACHE_BYTES + 1))
  assert.equal(cache.get('c'), undefined)
  assert.ok(cache.get('b'))
  cache.set('d', audio(MAX_CACHE_BYTES - big))
  assert.equal(cache.bytes, MAX_CACHE_BYTES)
  assert.equal(cache.size, 2)
  // Replacing an entry counts its bytes once.
  cache.set('d', audio(1))
  assert.equal(cache.bytes, big + 1)
})

test('replay keys are [text, language]: identical text in another language misses', () => {
  assert.equal(replayKey('안녕', 'ko'), JSON.stringify(['안녕', 'ko']))
  const cache = createReplayCache()
  cache.set(replayKey('same', 'en'), audio(2))
  assert.equal(cache.get(replayKey('same', 'ko')), undefined)
  assert.ok(cache.get(replayKey('same', 'en')))
})

test('speech language is one of the page languages, otherwise auto', () => {
  const codes = ['auto', 'en', 'ko', 'ja', 'fr', 'es', 'zh']
  for (const code of codes) assert.equal(speechLanguage(code, codes), code)
  for (const code of ['other', '', undefined, 'de']) assert.equal(speechLanguage(code, codes), 'auto')
  assert.equal(speechLanguage('zh', ['en', 'ko']), 'auto')
})

test('parseRate reads the L16 rate parameter', () => {
  assert.equal(parseRate('audio/L16;rate=24000;channels=1'), 24000)
  assert.equal(parseRate('audio/L16; rate=8000; channels=1'), 8000)
  assert.equal(parseRate('audio/L16;channels=1'), null)
  assert.equal(parseRate('application/json'), null)
  assert.equal(parseRate(null), null)
})

/** A /speech response whose body yields `chunks` one read at a time, then
 * ends, or fails on the next read when `cut` (a connection cut short). */
function speechResponse(chunks, { cut = false, status = 200 } = {}) {
  const queue = chunks.map((chunk) => new Uint8Array(chunk))
  const body = new ReadableStream(
    {
      pull(controller) {
        if (queue.length) controller.enqueue(queue.shift())
        else if (cut) controller.error(new TypeError('network error'))
        else controller.close()
      },
    },
    { highWaterMark: 0 },
  )
  return new Response(body, { status, headers: { 'Content-Type': 'audio/L16;rate=24000;channels=1' } })
}

function fakePlayer(onAppend = () => {}) {
  const appended = []
  return {
    appended,
    ended: false,
    append(bytes, rate) {
      appended.push([bytes.length, rate])
      onAppend()
      return bytes.length > 1
    },
    endInput() {
      this.ended = true
      return Promise.resolve('finished')
    },
  }
}

function load(res, { cache = createReplayCache(), current = () => true, player = fakePlayer() } = {}) {
  let plays = 0
  const owner = { controller: new AbortController() }
  const run = loadAudio({
    key: 'k', body: new FormData(), player, cache, owner, isCurrent: current,
    playing: () => plays++, request: async () => res,
  })
  return { run, cache, player, owner, plays: () => plays }
}

test('loadAudio caches only a completely read body and replays it without a request', async () => {
  const { run, cache, player, plays } = load(speechResponse([[0, 0, 1], [2]]))
  assert.equal(await run, true)
  assert.deepEqual(player.appended, [[3, 24000], [1, 24000]])
  assert.equal(plays(), 1)
  assert.equal(cache.bytes, 4)
  const replay = fakePlayer()
  let requests = 0
  const again = loadAudio({
    key: 'k', body: new FormData(), player: replay, cache, owner: { controller: new AbortController() },
    isCurrent: () => true, playing: () => {}, request: async () => requests++,
  })
  assert.equal(await again, true)
  assert.equal(requests, 0)
  assert.deepEqual(replay.appended, [[3, 24000], [1, 24000]])
})

test('loadAudio rejects a body cut short and caches nothing', async () => {
  const { run, cache, player } = load(speechResponse([[0, 0, 1, 1], [2, 2]], { cut: true }))
  await assert.rejects(run)
  // Both chunks played before the cut; none of it is kept for replay.
  assert.deepEqual(player.appended, [[4, 24000], [2, 24000]])
  assert.equal(cache.size, 0)
  assert.equal(player.ended, false)
})

test('loadAudio stopped mid-read drops the remaining bytes and caches nothing', async () => {
  let current = true
  const player = fakePlayer(() => {
    current = false // Stop tapped while the first chunk plays.
  })
  const { run, cache } = load(speechResponse([[0, 0], [1, 1], [2, 2]]), { current: () => current, player })
  assert.equal(await run, false)
  assert.deepEqual(player.appended, [[2, 24000]])
  assert.equal(cache.size, 0)
  assert.equal(player.ended, false)
})

test('loadAudio rejects error responses and drops a superseded stream', async () => {
  await assert.rejects(load(speechResponse([[0, 0]], { status: 502 })).run)
  let current = true
  const res = speechResponse([[0, 0]])
  const stale = load(res, { current: () => current })
  current = false
  assert.equal(await stale.run, false)
  assert.equal(stale.cache.size, 0)
  assert.deepEqual(stale.player.appended, [])
})
