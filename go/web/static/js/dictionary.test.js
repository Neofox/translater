import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextActive, selectTab } from './dictionary.js'

test('the active POS tab persists across swaps of the same run', () => {
  let state = nextActive({ run: null, active: 0 }, 'a', 3)
  state = selectTab(state, 2)
  assert.deepEqual(nextActive(state, 'a', 3), { run: 'a', active: 2 })
})

test('a new run resets the active tab', () => {
  const state = selectTab({ run: 'a', active: 0 }, 1)
  assert.deepEqual(nextActive(state, 'b', 3), { run: 'b', active: 0 })
})

test('an index past the POS list falls back to the first tab', () => {
  assert.deepEqual(nextActive({ run: 'a', active: 2 }, 'a', 2), { run: 'a', active: 0 })
  assert.deepEqual(nextActive({ run: 'a', active: 1 }, 'a', 0), { run: 'a', active: 0 })
})
