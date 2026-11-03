import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activate, reconcile } from './learning.js'

const closed = { identity: 'a:true', open: false, activation: 0 }

test('an activation opens and counts in a layout with the reference pane', () => {
  let state = activate(closed, { canOpen: true, separate: true })
  assert.deepEqual(state, { identity: 'a:true', open: true, activation: 1 })
  // Every activation counts, so the heading takes focus again.
  state = activate(state, { canOpen: true, separate: true })
  assert.deepEqual(state, { identity: 'a:true', open: true, activation: 2 })
})

test('an activation toggles without the reference pane', () => {
  const open = activate(closed, { canOpen: true, separate: false })
  assert.equal(open.open, true)
  assert.equal(activate(open, { canOpen: true, separate: false }).open, false)
})

test('nothing opens while the result cannot', () => {
  assert.equal(activate(closed, { canOpen: false, separate: true }), closed)
})

test('a new identity closes; the same one keeps the state', () => {
  const open = { identity: 'a:true', open: true, activation: 3 }
  assert.equal(reconcile(open, 'a:true'), open)
  assert.deepEqual(reconcile(open, 'a:false'), { identity: 'a:false', open: false, activation: 3 })
  assert.deepEqual(reconcile(open, 'b:true'), { identity: 'b:true', open: false, activation: 3 })
})
