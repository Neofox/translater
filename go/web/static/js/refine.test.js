import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHIPS, MAX_UNDO, add, canSubmit, customLabel, remove, summary } from './refine.js'

const empty = { refinements: [], previousMain: '', stack: [] }
const [softer, direct, shorter, playful] = Object.values(CHIPS)

test('add caps at 3 and dedupes', () => {
  let s = add(empty, softer, '내일 봐요', 'snap')
  assert.deepEqual(s.refinements, [softer])
  assert.equal(add(s, softer, 'x', 'snap'), null)
  s = add(add(s, direct, 'a', 'snap'), shorter, 'b', 'snap')
  assert.deepEqual(s.refinements, [softer, direct, shorter])
  assert.equal(add(s, playful, 'c', 'snap'), null)
})

test('add trims and slices free text, and allows one custom entry', () => {
  assert.equal(add(empty, '   ', 'm', 'snap'), null)
  const s = add(empty, `  ${'r'.repeat(250)} `, 'm', 'snap')
  assert.deepEqual(s.refinements, ['r'.repeat(200)])
  assert.equal(add(s, 'warmer', 'm', 'snap'), null)
  assert.deepEqual(add(s, softer, 'm', 'snap').refinements, ['r'.repeat(200), softer])
})

test('previousMain is the main being refined, and empty once nothing is left', () => {
  let s = add(empty, softer, '내일 봐요', 's0')
  assert.equal(s.previousMain, '내일 봐요')
  s = add(s, direct, '내일 봬요', 's1')
  assert.equal(s.previousMain, '내일 봬요')
  s = remove(s, 0, '내일 뵈어요', 's2')
  assert.deepEqual(s.refinements, [direct])
  assert.equal(s.previousMain, '내일 뵈어요')
  s = remove(s, 0, '내일 봐', 's3')
  assert.deepEqual(s.refinements, [])
  assert.equal(s.previousMain, '')
  assert.deepEqual(s.stack, ['s0', 's1', 's2', 's3'])
  assert.equal(remove(s, 0, 'x', 's4'), null)
})

test('the undo stack keeps the last 10 snapshots', () => {
  let s = empty
  for (let i = 0; i < 12; i++) {
    s = add(s, softer, `m${i}`, i)
    s = { ...remove(s, 0, `m${i}`, i), stack: s.stack }
  }
  assert.equal(MAX_UNDO, 10)
  assert.deepEqual(s.stack, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
})

test('customLabel shows the first 20 characters', () => {
  assert.equal(customLabel('make it a bit less formal'), 'make it a bit less f…')
  assert.equal(customLabel('x'.repeat(20)), 'x'.repeat(20))
})

test('summary names chips by their label and shortens custom text', () => {
  const t = (key) => ({ refineSofter: 'Softer', refineShorter: 'Shorter' })[key] ?? key
  assert.equal(summary([], t), '')
  assert.equal(summary([softer, shorter], t), 'Softer · Shorter')
  assert.equal(summary([softer, 'make it a bit less formal'], t), 'Softer · make it a bit less f…')
})

test('canSubmit rejects a blank draft, the cap and a second custom entry', () => {
  assert.equal(canSubmit([], '  '), false)
  assert.equal(canSubmit([], ' warmer '), true)
  assert.equal(canSubmit([softer, direct], 'warmer'), true)
  assert.equal(canSubmit([softer, direct, shorter], 'warmer'), false)
  assert.equal(canSubmit(['gentler'], 'warmer'), false)
})
