import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activate, mainSegments, mirrorSegments, reconcile, selectChunk } from './learning.js'

const closed = { identity: 'a:true', open: false, activation: 0, chunk: null }

test('an activation opens and counts in a layout with the reference pane', () => {
  let state = activate(closed, { canOpen: true, separate: true })
  assert.deepEqual(state, { identity: 'a:true', open: true, activation: 1, chunk: null })
  // Every activation counts, so the heading takes focus again.
  state = activate(state, { canOpen: true, separate: true })
  assert.deepEqual(state, { identity: 'a:true', open: true, activation: 2, chunk: null })
})

test('an activation toggles without the reference pane', () => {
  const open = activate(closed, { canOpen: true, separate: false })
  assert.equal(open.open, true)
  assert.equal(activate(open, { canOpen: true, separate: false }).open, false)
})

test('nothing opens while the result cannot', () => {
  assert.equal(activate(closed, { canOpen: false, separate: true }), closed)
})

test('a new identity closes and drops the selected phrase; the same one keeps the state', () => {
  const open = { identity: 'a:true', open: true, activation: 3, chunk: 1 }
  assert.equal(reconcile(open, 'a:true'), open)
  assert.deepEqual(reconcile(open, 'a:false'), { identity: 'a:false', open: false, activation: 3, chunk: null })
  assert.deepEqual(reconcile(open, 'b:true'), { identity: 'b:true', open: false, activation: 3, chunk: null })
})

test('selecting a row opens learning on that phrase; collapsing keeps it open (useLearning selectChunk)', () => {
  const one = selectChunk(closed, 2)
  assert.deepEqual(one, { identity: 'a:true', open: true, activation: 0, chunk: 2 })
  assert.deepEqual(selectChunk(one, null), { ...one, chunk: null })
})

const seg = (from, to, kind) => ({ from, to, kind })

// InspectableTranslation.tsx: grammar annotations become inspectable
// phrases; a later range starting before the end of the previous one is
// skipped (start < cursor), never split or merged.
test('main segments mark grammar annotations and skip overlaps', () => {
  assert.deepEqual(mainSegments(10, [[7, 10]], null), [seg(0, 7, 'text'), seg(7, 10, 'phrase')])
  assert.deepEqual(mainSegments(10, [[2, 6], [4, 8]], null), [seg(0, 2, 'text'), seg(2, 6, 'phrase'), seg(6, 10, 'text')])
  assert.deepEqual(mainSegments(4, [[0, 4]], null), [seg(0, 4, 'phrase')])
})

// The selected chunk is one mark; annotations inside it are not rendered,
// one crossing its edge is clipped to the text outside it.
test('main segments keep the selected chunk whole, annotations around it', () => {
  assert.deepEqual(mainSegments(12, [[2, 5], [5, 7], [8, 12]], [3, 7]), [
    seg(0, 2, 'text'), seg(2, 3, 'phrase'), seg(3, 7, 'selected'), seg(7, 8, 'text'), seg(8, 12, 'phrase'),
  ])
  assert.deepEqual(mainSegments(5, [], [0, 5]), [seg(0, 5, 'selected')])
})

test('empty text has no segments', () => {
  assert.deepEqual(mainSegments(0, [], null), [])
  assert.deepEqual(mirrorSegments(0, [], []), [])
})

// SourceHighlight.tsx: highlighted spans sorted by start (overlaps skipped),
// grammar annotations only in the text between them.
test('mirror segments mark spans and underline grammar outside them', () => {
  assert.deepEqual(mirrorSegments(14, [[3, 7]], [[5, 7], [10, 14]]), [
    seg(0, 3, 'text'), seg(3, 7, 'mark'), seg(7, 10, 'text'), seg(10, 14, 'grammar'),
  ])
  assert.deepEqual(mirrorSegments(10, [[8, 10], [0, 2], [1, 3]], []), [
    seg(0, 2, 'mark'), seg(2, 8, 'text'), seg(8, 10, 'mark'),
  ])
  assert.deepEqual(mirrorSegments(9, [], [[0, 2], [5, 9]]), [seg(0, 2, 'grammar'), seg(2, 5, 'text'), seg(5, 9, 'grammar')])
})
