import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInterpolator, graphemeEnds } from './stream.js'

const graphemes = (s) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((p) => p.segment)

test('graphemeEnds counts whole graphemes after the offset', () => {
  assert.deepEqual(graphemeEnds('a👍🏽b', 0), [1, 5, 6])
  assert.deepEqual(graphemeEnds('a👍🏽b', 1), [5, 6])
  assert.deepEqual(graphemeEnds('한국', 1), [2])
})

/** Drive the interpolator with a manual clock and frame queue. */
function harness() {
  let time = 0
  const frames = []
  const shown = []
  const interp = createInterpolator((text) => shown.push(text), {
    now: () => time,
    frame: (cb) => frames.push(cb),
    cancel: () => frames.splice(0),
  })
  const step = (ms) => {
    time += ms
    const cb = frames.shift()
    cb?.()
  }
  return { interp, shown, step, frames }
}

test('interpolator emits only whole-grapheme prefixes within 100ms', () => {
  const { interp, shown, step, frames } = harness()
  const text = '👨‍👩‍👧 가나다 🇰🇷!'
  interp.set(text)
  for (let i = 0; i < 20 && frames.length; i++) step(10)
  assert.equal(shown.at(-1), text)
  assert.equal(frames.length, 0, 'done within the burst window')
  const valid = new Set()
  let prefix = ''
  for (const g of graphemes(text)) valid.add((prefix += g))
  for (const s of shown) assert.ok(valid.has(s), `split grapheme: ${JSON.stringify(s)}`)
})

test('interpolator continues from the shown prefix and flushes', () => {
  const { interp, shown, step } = harness()
  interp.set('안녕')
  step(100)
  assert.equal(shown.at(-1), '안녕')
  interp.set('안녕하세요')
  step(0)
  assert.ok(shown.at(-1).startsWith('안녕') && shown.at(-1).length > 2)
  interp.flush('안녕하세요.')
  assert.equal(interp.text, '안녕하세요.')
  interp.reset()
  assert.equal(shown.at(-1), '')
})

test('immediate mode writes directly', () => {
  const shown = []
  const interp = createInterpolator((t) => shown.push(t), { immediate: () => true, frame: () => assert.fail('no frames') })
  interp.set('abc')
  assert.deepEqual(shown, ['abc'])
})
