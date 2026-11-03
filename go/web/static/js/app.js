// Translator page entry: state, routing and runs. Runs are htmx requests of
// #translate-form (hx-trigger="nt-run", hx-sync="this:replace"); the form
// holds only hidden inputs, so the textarea is never part of any swap.

import {
  detectIntent,
  detectLanguage,
  fallbackTargetFor,
  initComposer,
  resolveTarget,
  routingDetected,
} from './composer.js'
import { initContext } from './context.js'
import { initCopy, requestKey } from './copy.js'
import { initDictionary } from './dictionary.js'
import { initLayout } from './layout.js'
import { initPrefs } from './prefs.js'
import { initStream } from './stream.js'

const data = JSON.parse(document.getElementById('nt-data').textContent)
const form = document.getElementById('translate-form')
const ta = document.querySelector('[data-testid="input-textarea"]')
const VALID_DETECTED = ['en', 'ko', 'ja', 'fr', 'es', 'zh']
const REGISTER = { friends: '반말', casual: '해요체', professional: '존댓말' }

let composer, stream, copy, prefs, dictionary
// The model's report for an exact input, kept while that input stays.
let modelDetected = null
// Input for which the done-time safety net already flipped the target.
let flipGuard = null
// Run analytics (useTranslate.ts), sent to Langfuse only: a per-page id
// (memory only, never a durable user id), the input revision, and the run a
// new run replaces. Never part of the request key.
const analyticsSessionId = crypto.randomUUID()
let inputRevision = ta.value.trim() ? 1 : 0
let revisedText = ta.value
let supersededRun = null

const app = {
  prefs: data.prefs,
  /** The current run: { run, key, detected (its routing language), text,
   * intent, source, target, raw, main, mainReady, done, error, aborted,
   * sourceLang, rationale, formality, register }. */
  live: null,
  pending: false,
  t: (key) => data.strings[app.prefs.uiLang]?.[key] ?? data.strings.en[key] ?? key,
  streaming: () => Boolean(app.pending && app.live && !app.live.done && !app.live.aborted),
  /** The raw reply context (context.js). */
  context: () => '',
  refinements: () => [],

  detected() {
    if (app.prefs.source !== 'auto') return null
    const trimmed = ta.value.trim()
    if (!trimmed) return null
    const live = app.live
    if (live && live.text === trimmed && live.source === 'auto' && VALID_DETECTED.includes(live.sourceLang))
      return live.sourceLang
    if (modelDetected?.text === trimmed) return modelDetected.lang
    return detectLanguage(trimmed)
  },
  routingDetected: () =>
    routingDetected({ source: app.prefs.source, text: ta.value, live: app.live, model: modelDetected }),
  translationTarget() {
    const { source, target } = app.prefs
    const detected = flipGuard === ta.value.trim() ? null : app.routingDetected()
    return resolveTarget({ source, target, detected })
  },
  currentKey() {
    const { source, mode, uiLang } = app.prefs
    return requestKey({
      text: ta.value, source, target: app.translationTarget(), mode,
      context: app.context(), refinements: app.refinements(), uiLang,
    })
  },

  /** Auto source: keep the target away from the detected language. */
  autoSwap() {
    if (!ta.value.trim() || app.prefs.source !== 'auto' || !app.routingDetected()) return
    const target = app.translationTarget()
    if (target !== app.prefs.target) prefs.set('target', target, { quiet: true })
  },

  /** Stop the in-flight run; its late events are ignored from now on. The
   * next run reports that it supersedes it. */
  abort() {
    if (!app.pending) return
    app.pending = false
    if (app.live) supersededRun = app.live.run
    if (app.live) app.live.aborted = true
    htmx.trigger(form, 'htmx:abort')
    stream.stop()
  },

  inputChanged() {
    app.abort()
    if (ta.value !== revisedText) {
      revisedText = ta.value
      inputRevision += 1
    }
    const trimmed = ta.value.trim()
    if (flipGuard !== trimmed) flipGuard = null
    if (!trimmed) {
      supersededRun = null
      app.live = null
      stream.clear()
    }
    app.autoSwap()
    prefs.syncDetected()
    updateCount()
    app.updateActions()
  },

  /** Tone, languages or UI language changed: abort and re-run debounced. */
  settingsChanged() {
    app.abort()
    app.autoSwap()
    updateCount()
    app.updateActions()
    composer.schedule()
  },

  /** Start a run now; `trigger` says why (debounce, paste, blur, force…). */
  run(trigger = 'force') {
    const text = ta.value
    const trimmed = text.trim()
    if (!trimmed) return
    app.abort()
    composer.clearTimer()
    const { source, mode, uiLang } = app.prefs
    const target = app.translationTarget()
    const intent = detectIntent(text)
    const live = {
      run: crypto.randomUUID(), key: app.currentKey(), detected: app.routingDetected(),
      text: trimmed, intent, source, target,
      raw: '', main: undefined, mainReady: false, done: false, error: null, aborted: false,
      sourceLang: null, rationale: '', formality: '',
      register: intent === 'sentence' && target === 'ko' ? REGISTER[mode] : '',
    }
    app.live = live
    if (trimmed.length > data.limits.maxInputChars) {
      stream.start(live)
      stream.showError(
        app.t('inputTooLong'),
        app.t('inputTooLongHint').replace('{max}', data.limits.maxInputChars).replace('{count}', trimmed.length),
      )
      return
    }
    const values = {
      run: live.run, text: trimmed, source, target, mode, intent, uiLang,
      context: app.context(), previousMain: '', refinements: '',
      analyticsSessionId, supersedesRunId: supersededRun ?? '', inputRevision, trigger,
    }
    supersededRun = null
    for (const [name, value] of Object.entries(values))
      if (form.elements[name]) form.elements[name].value = value
    app.pending = true
    stream.start(live)
    htmx.trigger(form, 'nt-run')
  },

  /** The model named the source language of the current run. */
  sourceReported(live) {
    if (live.source !== 'auto' || !VALID_DETECTED.includes(live.sourceLang)) return
    const same = modelDetected?.text === live.text && modelDetected.lang === live.sourceLang
    if (!same) modelDetected = { text: live.text, lang: live.sourceLang }
    prefs.syncDetected()
  },

  /** Safety net: the model says the source IS the target; flip once. */
  sourceDone(live) {
    if (live.source !== 'auto' || app.prefs.source !== 'auto' || live.text !== ta.value.trim()) return
    const reported = live.sourceLang
    if (!VALID_DETECTED.includes(reported) || reported !== app.prefs.target || flipGuard === live.text) return
    flipGuard = live.text
    prefs.set('target', fallbackTargetFor(reported))
  },

  updateActions() {
    copy.updateActions()
    dictionary?.sync()
  },
  copyMain: () => copy.copyMain(),
  warm: () => fetch('/warm', { method: 'POST' }).catch(() => {}),
  setSwapBusy(busy) {
    const button = document.querySelector('.swap-button')
    if (!button) return
    // The icons are <svg>: SVGElement has no `hidden` property.
    button.querySelector('[data-icon="swap"]').toggleAttribute('hidden', busy)
    button.querySelector('[data-icon="busy"]').toggleAttribute('hidden', !busy)
  },
}

function updateCount() {
  const length = ta.value.length
  const max = data.limits.maxInputChars
  const show = length >= max * data.limits.inputWarnFraction
  const el = document.querySelector('.input-count')
  el.textContent = app.t(show ? 'charCount' : 'inputCount').replace('{count}', length).replace('{max}', max)
  // InputPanel's template literal, spaces included.
  el.className = `input-count ${show ? 'input-count-visible' : ''} ${length > max ? 'text-red-400' : 'text-ink-dim'}`
  if (show) el.setAttribute('aria-live', 'polite')
  else el.removeAttribute('aria-live')
}

// Swap languages (OutputPanel.tsx): a finished result becomes the new input.
document.querySelector('.swap-button')?.addEventListener('click', () => {
  const { source, target } = app.prefs
  const from = source === 'auto' ? (app.detected() ?? 'en') : source
  const live = app.live
  const main = live?.done && !live.error && live.key === app.currentKey() ? live.main : null
  if (main) {
    composer.replaceText(main, false)
    prefs.set('source', 'auto')
    prefs.set('target', from)
  } else {
    prefs.set('source', target)
    prefs.set('target', from)
  }
})

// Retry a failed run with the current input (TS run(undefined, 'force')).
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element && event.target.closest('.retry-button'))) return
  composer.clearTimer()
  app.run('force')
})

// Measure first: the panels leave their pending first paint before the
// composer sizes the textarea.
app.layout = initLayout(document.querySelector('.translator-panels'))
stream = initStream(app, form)
copy = initCopy(app)
prefs = initPrefs(app, data)
composer = initComposer(app, ta)
dictionary = initDictionary(app, composer)
// InputPanel re-sizes the editor whenever the layout changes.
document.addEventListener('nt-layout', () => {
  composer.resize()
  dictionary.sync()
})
initContext(app, () => composer.resize(), (root) => prefs.applyStrings(root))
updateCount()
copy.updateActions()
if (matchMedia('(pointer: fine)').matches) ta.focus()
