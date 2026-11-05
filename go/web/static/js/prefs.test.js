import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodePrefsCookie } from './prefs.js'

const rules = {
  cookie: 'nt.preferences',
  version: 1,
  maxAge: 31536000,
  fields: ['source', 'target', 'mode', 'uiLang', 'recentSource', 'recentTarget'],
}

test('cookie matches encodePreferencesCookie byte for byte', () => {
  const prefs = { uiLang: 'ko', source: 'auto', target: 'fr', mode: 'casual', recentSource: null, recentTarget: 'fr' }
  const json = '{"version":1,"source":"auto","target":"fr","mode":"casual","uiLang":"ko","recentSource":null,"recentTarget":"fr"}'
  assert.equal(
    encodePrefsCookie(prefs, rules, false),
    `nt.preferences=${encodeURIComponent(json)}; Path=/; Max-Age=31536000; SameSite=Lax`,
  )
  assert.ok(encodePrefsCookie(prefs, rules, true).endsWith('; Secure'))
})
