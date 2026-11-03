import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fit } from './adjust.js'

test('the trigger is icon-only below 112 px', () => {
  assert.equal(fit(111, [60], 6, 50).iconOnly, true)
  assert.equal(fit(112, [60], 6, 50).iconOnly, false)
})

test('chips show in the header from needed + 2 px', () => {
  // needed = 50 + 70 + 1 gap of 6 + label 40 + 14 = 180
  assert.equal(fit(181, [50, 70], 6, 40).fits, false)
  assert.equal(fit(182, [50, 70], 6, 40).fits, true)
  // Fractional widths add up before the comparison.
  assert.equal(fit(182, [50.5, 69.5], 6, 40).fits, true)
  // One button: no gap.
  assert.equal(fit(116, [50], 6, 50).fits, true)
  assert.equal(fit(115, [50], 6, 50).fits, false)
})
