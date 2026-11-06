import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COPIED_MS, copyableMain, flashCopied, requestKey } from './copy.js'

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

/** The parts of an element the Copied state touches. */
function element(attrs = {}) {
  const map = new Map(Object.entries(attrs))
  return {
    textContent: '',
    getAttribute: (name) => map.get(name) ?? null,
    setAttribute: (name, value) => map.set(name, String(value)),
    hasAttribute: (name) => map.has(name),
    toggleAttribute(name, force) {
      const on = force ?? !map.has(name)
      if (on) map.set(name, '')
      else map.delete(name)
      return on
    },
  }
}

/** A Copy button: the copy icon, the hidden check icon and, on the main
 * one, the visible label. */
function copyButton({ label = true } = {}) {
  const parts = {
    '.lucide-copy': element(),
    '.lucide-check': element({ hidden: '' }),
    '[data-t="copy"]': label ? element() : null,
  }
  return Object.assign(element({ 'aria-label': 'Copy', title: 'Copy' }), {
    parts,
    querySelector: (selector) => parts[selector] ?? null,
  })
}

const t = (key) => ({ copy: 'Copy', copied: 'Copied' })[key]

/** What a user sees and hears from the button. */
function seen(button) {
  return {
    name: button.getAttribute('aria-label'),
    title: button.getAttribute('title'),
    label: button.parts['[data-t="copy"]']?.textContent ?? null,
    copied: button.hasAttribute('data-copied'),
    check: !button.parts['.lucide-check'].hasAttribute('hidden'),
    copyIcon: !button.parts['.lucide-copy'].hasAttribute('hidden'),
  }
}

const COPIED = { name: 'Copied', title: 'Copied', copied: true, check: true, copyIcon: false }
const IDLE = { name: 'Copy', title: 'Copy', copied: false, check: false, copyIcon: true }

test('a copy shows the check icon and the Copied name for 1.5 s', (t2) => {
  assert.equal(COPIED_MS, 1500)
  t2.mock.timers.enable({ apis: ['setTimeout'] })
  const button = copyButton()
  flashCopied(button, t)
  assert.deepEqual(seen(button), { ...COPIED, label: 'Copied' })
  t2.mock.timers.tick(COPIED_MS - 1)
  assert.equal(seen(button).copied, true)
  t2.mock.timers.tick(1)
  assert.deepEqual(seen(button), { ...IDLE, label: 'Copy' })
})

test('another copy restarts the confirmation', (t2) => {
  t2.mock.timers.enable({ apis: ['setTimeout'] })
  // An alternative row's icon-only button has no visible label.
  const button = copyButton({ label: false })
  flashCopied(button, t)
  t2.mock.timers.tick(1000)
  flashCopied(button, t)
  t2.mock.timers.tick(COPIED_MS - 1)
  assert.deepEqual(seen(button), { ...COPIED, label: null })
  t2.mock.timers.tick(1)
  assert.deepEqual(seen(button), { ...IDLE, label: null })
})
