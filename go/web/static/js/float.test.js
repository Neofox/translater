import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compute, panelBoundary } from './float.js'

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
const viewport = rect(0, 0, 800, 600)
const base = { floating: { width: 200, height: 100 }, clip: viewport, padding: 8, dpr: 1 }

test('bottom-start sits below the reference after the offset', () => {
  const r = compute({ ...base, reference: rect(100, 50, 40, 20), placement: 'bottom-start', offset: 6 })
  assert.deepEqual([r.x, r.y, r.placement], [100, 76, 'bottom-start'])
})

test('bottom-end aligns the right edges', () => {
  const r = compute({ ...base, reference: rect(500, 50, 40, 20), placement: 'bottom-end', offset: 8 })
  assert.deepEqual([r.x, r.y], [340, 78])
})

test('shift keeps the panel inside the clip rect minus padding', () => {
  const left = compute({ ...base, reference: rect(20, 50, 40, 20), placement: 'bottom-end', offset: 8 })
  assert.equal(left.x, 8)
  const right = compute({ ...base, reference: rect(700, 50, 40, 20), placement: 'bottom-start', offset: 8 })
  assert.equal(right.x, 592)
  // Wider than the room: the start edge wins (Floating UI's clamp order).
  const wide = compute({ ...base, floating: { width: 900, height: 100 }, reference: rect(300, 50, 40, 20), placement: 'bottom-start' })
  assert.equal(wide.x, 8)
})

test('per-side padding', () => {
  const padding = { top: 8, right: 30, bottom: 8, left: 50 }
  assert.equal(compute({ ...base, padding, reference: rect(10, 50, 40, 20), placement: 'bottom-start' }).x, 50)
  assert.equal(compute({ ...base, padding, reference: rect(700, 50, 40, 20), placement: 'bottom-start' }).x, 570)
})

test('a boundary narrows the clip rect', () => {
  const clip = rect(400, 0, 400, 600)
  const r = compute({ ...base, clip, reference: rect(380, 50, 40, 20), placement: 'bottom-start', offset: 6 })
  assert.equal(r.x, 408)
})

test('flip moves above when the bottom overflows and the top fits', () => {
  const reference = rect(100, 550, 40, 20)
  const r = compute({ ...base, reference, placement: 'bottom-start', offset: 6, flip: true })
  assert.deepEqual([r.y, r.placement], [444, 'top-start'])
  const kept = compute({ ...base, reference, placement: 'bottom-start', offset: 6 })
  assert.deepEqual([kept.y, kept.placement], [576, 'bottom-start'])
})

test('flip keeps the side that overflows less when neither fits', () => {
  const floating = { width: 200, height: 400 }
  // Below: 600-8 - (330+6) = 256 px room; above: 300-6-8 = 286 px room.
  const up = compute({ ...base, floating, reference: rect(100, 300, 40, 30), placement: 'bottom-start', offset: 6, flip: true })
  assert.equal(up.placement, 'top-start')
  const down = compute({ ...base, floating, reference: rect(100, 250, 40, 30), placement: 'bottom-start', offset: 6, flip: true })
  assert.equal(down.placement, 'bottom-start')
})

test('flip tries the other alignment: the least alignment overflow among boxes that fit their side', () => {
  // A wide list under a trigger near the right edge of a 368 px pane
  // (Floating UI 1.8 picks bottom-end, then shift clamps the left edge).
  const opts = {
    ...base,
    clip: rect(0, 57, 368, 537),
    floating: { width: 344, height: 142 },
    reference: rect(228.34375, 65, 110, 44),
    placement: 'bottom-start',
    offset: 6,
  }
  const flipped = compute({ ...opts, flip: true })
  assert.deepEqual([flipped.placement, flipped.x, flipped.y], ['bottom-end', 8, 115])
  assert.equal(compute(opts).x, 16)
  // A box that fits where it is stays (Settings: bottom-end at the right).
  const fits = compute({ ...base, reference: rect(700, 10, 44, 44), placement: 'bottom-end', offset: 8, flip: true })
  assert.deepEqual([fits.placement, fits.x], ['bottom-end', 544])
})

test('a top placement stays on top without flip', () => {
  const r = compute({ ...base, reference: rect(100, 300, 40, 20), placement: 'top-start', offset: 6 })
  assert.deepEqual([r.y, r.placement], [194, 'top-start'])
})

test('available height on either side', () => {
  const below = compute({ ...base, reference: rect(100, 50, 40, 20), placement: 'bottom-start', offset: 6 })
  assert.equal(below.availableHeight, 600 - 8 - 76)
  const above = compute({ ...base, reference: rect(100, 550, 40, 20), placement: 'bottom-start', offset: 6, flip: true })
  assert.equal(above.availableHeight, 550 - 6 - 8)
})

test('clearance moves the panel left of overlapping primary actions', () => {
  const opts = { ...base, padding: 16, reference: rect(500, 40, 60, 40), placement: 'bottom-start', offset: 12 }
  // y = 92, panel spans 92..192 vertically.
  const actions = rect(600, 150, 100, 44)
  assert.equal(compute({ ...opts, clearance: actions }).x, 600 - 200 - 12)
  // No vertical overlap: unchanged.
  assert.equal(compute({ ...opts, clearance: rect(600, 300, 100, 44) }).x, 500)
  assert.equal(compute({ ...opts, clearance: rect(600, 192, 100, 44) }).x, 500)
  // Never past 16 px from the left edge.
  assert.equal(compute({ ...opts, clearance: rect(150, 150, 100, 44) }).x, 16)
})

test('coordinates round to device pixels', () => {
  const r = compute({ ...base, dpr: 2, reference: rect(100.3, 50.2, 40, 20.1), placement: 'bottom-start', offset: 6 })
  assert.deepEqual([r.x, r.y], [100.5, 76.5])
})

/** A minimal element: closest() over a fixed ancestor map. */
function fakeElement(ancestors) {
  return { closest: (selector) => ancestors[selector] ?? null }
}

test('panelBoundary: segmented layouts bound to the section, others to the viewport', () => {
  const insets = { top: '0px', right: '12px', bottom: '34px', left: '' }
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => insets[name.replace('--safe-area-', '')] ?? '',
  })
  try {
    const section = { tagName: 'SECTION' }
    for (const layout of ['book', 'laptop', 'split', 'workspace']) {
      const ref = fakeElement({ section, '.translator-panels': { dataset: { layout } } })
      const { boundary, padding } = panelBoundary(ref)
      assert.equal(boundary, section, layout)
      assert.deepEqual(padding, { top: 8, right: 20, bottom: 42, left: 8 })
    }
    const stack = panelBoundary(fakeElement({ section, '.translator-panels': { dataset: { layout: 'stack' } } }))
    assert.equal(stack.boundary, undefined)
    // The header trigger has no pane: the viewport.
    assert.equal(panelBoundary(fakeElement({})).boundary, undefined)
  } finally {
    delete globalThis.getComputedStyle
  }
})
