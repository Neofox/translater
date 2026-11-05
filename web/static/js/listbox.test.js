import { test } from 'node:test'
import assert from 'node:assert/strict'
import { typeahead } from './listbox.js'

const fresh = (prev = -1) => ({ typed: '', at: 0, prev, matched: null })

/** Type `keys` (one per 10 ms unless a number gives the gap) and return the
 * matched indices. */
function type(labels, keys, state = fresh()) {
  let now = 1000
  const out = []
  for (const k of keys) {
    if (typeof k === 'number') {
      now += k
      continue
    }
    now += 10
    state = typeahead(state, k, labels, now)
    out.push(state.index)
  }
  return out
}

const labels = ['Alpha', 'Beta', 'Avocado', 'Cherry']

test('the search starts after the selected or active option', () => {
  assert.deepEqual(type(labels, ['a']), [0])
  assert.deepEqual(type(labels, ['a'], fresh(0)), [2])
  assert.deepEqual(type(labels, ['a'], fresh(1)), [2])
  assert.deepEqual(type(labels, ['a'], fresh(2)), [0])
  // English-name labels: the Japanese option is found by "Japanese".
  assert.deepEqual(type(['English', 'Japanese', 'French'], ['j']), [1])
  // From the first option a unique match wraps around to it.
  assert.deepEqual(type(['English', 'Japanese', 'Spanish'], ['e'], fresh(0)), [0])
})

test('repeating a first letter cycles through its matches', () => {
  assert.deepEqual(type(labels, ['a', 'a', 'a']), [0, 2, 0])
})

test('no cycling when a label repeats its first letter', () => {
  assert.deepEqual(type(['Llama', 'Lemon'], ['l', 'l']), [0, 0])
})

test('longer prefixes keep matching from the same start', () => {
  assert.deepEqual(type(labels, ['a', 'v']), [0, 2])
})

test('a miss starts over', () => {
  assert.deepEqual(type(labels, ['a', 'x', 'b']), [0, -1, 1])
  // Without the reset "axb" would never match.
})

test('quiet longer than 750 ms starts a new search after the last match', () => {
  assert.deepEqual(type(labels, ['b', 800, 'a']), [1, 2])
  assert.deepEqual(type(labels, ['a', 700, 'v']), [0, 2])
})

test('a space continues a search but never starts over on a miss', () => {
  const s = typeahead(fresh(), ' ', ['A b'], 10)
  assert.equal(s.index, -1)
  assert.equal(s.typed, ' ')
})
