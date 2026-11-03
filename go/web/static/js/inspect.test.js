import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRACE_MS, isInspectTap } from './inspect.js'

const start = { x: 10, y: 10, time: 1000 }

test('a tap is shorter than 350 ms', () => {
  assert.equal(isInspectTap(start, { x: 10, y: 10, time: 1349 }, ''), true)
  assert.equal(isInspectTap(start, { x: 10, y: 10, time: 1350 }, ''), false)
})

test('a tap moves less than 8 px', () => {
  assert.equal(isInspectTap(start, { x: 17.9, y: 10, time: 1100 }, ''), true)
  assert.equal(isInspectTap(start, { x: 18, y: 10, time: 1100 }, ''), false)
  // Distance, not per axis: 6 and 6 is 8.49 px.
  assert.equal(isInspectTap(start, { x: 16, y: 16, time: 1100 }, ''), false)
})

test('a tap leaves no selection', () => {
  assert.equal(isInspectTap(start, { x: 10, y: 10, time: 1100 }, 'word'), false)
})

test('inspection waits for the selection grace period', () => {
  assert.equal(GRACE_MS, 400)
})
