import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CACHE_BYTES, createReplayCache, parseRate, replayKey, speechLanguage } from './speech.js'

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

test('speech language is a known code, otherwise auto', () => {
  for (const code of ['auto', 'en', 'ko', 'ja', 'fr', 'es', 'zh']) assert.equal(speechLanguage(code), code)
  for (const code of ['other', '', undefined, 'de']) assert.equal(speechLanguage(code), 'auto')
})

test('parseRate reads the L16 rate parameter', () => {
  assert.equal(parseRate('audio/L16;rate=24000;channels=1'), 24000)
  assert.equal(parseRate('audio/L16; rate=8000; channels=1'), 8000)
  assert.equal(parseRate('audio/L16;channels=1'), null)
  assert.equal(parseRate('application/json'), null)
  assert.equal(parseRate(null), null)
})
