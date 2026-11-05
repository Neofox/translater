import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyableMain, requestKey } from './copy.js'

const req = { text: ' hi ', source: 'auto', target: 'ko', mode: 'casual', context: '', refinements: [], uiLang: 'en' }

test('requestKey matches translationRequestKey', () => {
  assert.equal(requestKey(req), JSON.stringify(['hi', 'auto', 'ko', 'casual', '', [], 'en']))
  assert.notEqual(requestKey(req), requestKey({ ...req, uiLang: 'ko' }))
  assert.equal(requestKey(req), requestKey({ ...req, text: 'hi' }))
})

test('copyableMain requires a ready, current, error-free result', () => {
  const key = requestKey(req)
  const live = { key, main: '\n안녕 ', mainReady: true, done: false, error: null }
  assert.equal(copyableMain(live, key), '안녕')
  assert.equal(copyableMain({ ...live, mainReady: false }, key), null)
  assert.equal(copyableMain({ ...live, mainReady: false, done: true }, key), '안녕')
  assert.equal(copyableMain(live, requestKey({ ...req, text: 'other' })), null)
  assert.equal(copyableMain({ ...live, error: { message: 'x' } }, key), null)
  assert.equal(copyableMain({ ...live, main: ' ' }, key), null)
  assert.equal(copyableMain(null, key), null)
})
