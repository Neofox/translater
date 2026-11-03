import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPACT_LAYOUT, decideLayout, initialLayoutState } from './layout.js'

// A window whose measurements a test changes step by step, threading the
// layout state like layout.js's measure() does (cases from
// src/hooks/useWorkspaceLayout.test.tsx; jsdom's window is 1024 × 768).
function simulate({ width, innerWidth = 1024, innerHeight = 768, visible, sideInsets = 0, touch = false }) {
  const env = { width, innerWidth, innerHeight, visible, offsetTop: 0, scale: 1, sideInsets, editing: false, touch, posture: null }
  let state = initialLayoutState(innerWidth, innerHeight)
  let last
  const step = (changes = {}) => {
    Object.assign(env, changes)
    last = decideLayout({ ...env }, state)
    state = { natural: last.natural, layout: last.layout }
    return last
  }
  step()
  return { step, get: () => last }
}

test('the server first paint is the compact stack', () => {
  assert.deepEqual(COMPACT_LAYOUT, {
    mode: 'stack', resultFirst: true, desktop: false, short: false, tight: false, keyboard: false,
  })
})

for (const [width, height, expected] of [
  [1512, 982, 'workspace'],
  [1728, 1117, 'workspace'],
  [580, 382, 'split'],
  [736, 594, 'split'],
]) {
  test(`keeps the A workspace source first at ${width} × ${height} through keyboard changes`, () => {
    const sim = simulate({ width, innerWidth: width, innerHeight: height, visible: height })
    let { layout } = sim.get()
    assert.equal(layout.mode, expected)
    assert.equal(layout.resultFirst, false)
    assert.equal(layout.desktop, expected === 'workspace')
    sim.step({ editing: true })
    for (const visible of [height - 50, height - 100, 320]) layout = sim.step({ visible }).layout
    assert.equal(layout.mode, expected)
    assert.equal(layout.resultFirst, false)
  })
}

test('tracks the visible keyboard height', () => {
  const sim = simulate({ width: 594, visible: 736 })
  assert.equal(sim.get().appHeight, 736)
  assert.equal(sim.get().layout.mode, 'stack')
  let r = sim.step({ visible: 320 })
  assert.equal(r.appHeight, 320)
  assert.equal(r.layout.mode, 'split')
  assert.equal(r.layout.tight, true)
  assert.equal(r.layout.short, true)
  r = sim.step({ visible: 736 })
  assert.equal(r.layout.mode, 'stack')
  assert.equal(r.layout.tight, false)
})

test('chooses the compact layout from usable width when the background extends into side insets', () => {
  assert.equal(simulate({ width: 736, visible: 736, sideInsets: 160 }).get().layout.resultFirst, true)
  // 736 × 594 is split, but 160 px of insets leave 576 px: not wider than tall.
  assert.equal(simulate({ width: 736, innerHeight: 594, visible: 594 }).get().layout.mode, 'split')
  assert.equal(simulate({ width: 736, innerHeight: 594, visible: 594, sideInsets: 160 }).get().layout.mode, 'stack')
  // Workspace starts at 1100 px of usable width.
  assert.equal(simulate({ width: 1124, innerWidth: 1124, visible: 760, sideInsets: 24 }).get().layout.mode, 'workspace')
  assert.equal(simulate({ width: 1124, innerWidth: 1124, visible: 760, sideInsets: 25 }).get().layout.mode, 'split')
})

test('keeps landscape split before and during a panned Safari keyboard viewport', () => {
  const sim = simulate({ width: 960, innerHeight: 548, visible: 548 })
  assert.equal(sim.get().layout.mode, 'split')
  sim.step({ editing: true })
  let r = sim.step({ visible: 210, offsetTop: 90 })
  assert.equal(r.layout.mode, 'split')
  assert.equal(r.layout.keyboard, true)
  assert.equal(r.appTop, 90)
  r = sim.step({ offsetTop: 120 })
  assert.equal(r.appTop, 120)
  r = sim.step({ visible: 548 })
  assert.equal(r.layout.keyboard, false)
  assert.equal(r.appTop, 0)
})

test('keeps a portrait workspace stacked when its focused keyboard reduces visible height', () => {
  const sim = simulate({ width: 594, innerHeight: 736, visible: 736 })
  sim.step({ editing: true })
  let r
  for (const visible of [686, 636, 586, 536, 486, 436, 386, 336, 320]) r = sim.step({ visible })
  assert.equal(r.layout.mode, 'stack')
  assert.equal(r.layout.keyboard, true)
})

test('a touch keyboard counts once the visible height drops by a fifth', () => {
  const sim = simulate({ width: 390, innerWidth: 390, innerHeight: 844, visible: 844, touch: true })
  sim.step({ editing: true })
  assert.equal(sim.step({ visible: 700 }).layout.keyboard, false)
  assert.equal(sim.step({ visible: 500 }).layout.keyboard, true)
  // Without editing the keyboard flag clears once the height returns.
  assert.equal(sim.step({ editing: false, visible: 844 }).layout.keyboard, false)
})

test('pinch zoom is ignored: the layout height stays the window height', () => {
  const sim = simulate({ width: 594, innerHeight: 736, visible: 736 })
  sim.step({ editing: true })
  const r = sim.step({ scale: 2, visible: 300, offsetTop: 200 })
  assert.equal(r.appHeight, 736)
  assert.equal(r.appTop, 0)
  assert.equal(r.layout.keyboard, false)
  assert.equal(r.layout.mode, 'stack')
})

test('fold postures win over width', () => {
  const book = simulate({ width: 1512, innerWidth: 1512, innerHeight: 982, visible: 982 }).step({ posture: 'book' })
  assert.deepEqual([book.layout.mode, book.layout.resultFirst, book.layout.desktop], ['book', false, false])
  const laptop = simulate({ width: 1512, innerWidth: 1512, innerHeight: 982, visible: 982 }).step({ posture: 'laptop' })
  assert.deepEqual([laptop.layout.mode, laptop.layout.resultFirst], ['laptop', true])
})

test('an unchanged layout keeps its identity', () => {
  const sim = simulate({ width: 1512, innerWidth: 1512, innerHeight: 982, visible: 982 })
  const before = sim.get().layout
  assert.equal(sim.step({ visible: 981 }).layout, before)
})
