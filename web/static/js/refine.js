// Refinements: RefineRow.tsx's chips and custom adjustment, with
// TranslatorContext's refine state (caps, previousMain, the snapshot stack
// that rolls a failed refine back), inside the Adjust menu (adjust.js).
//
// Hand-written: these are app rules ported from the TS components; the
// markup is server-rendered once (refine.templ) and only updated here.

import { initAdjust } from './adjust.js'
import { showCopied } from './copy.js'

export const MAX_UNDO = 10
const MAX_REFINEMENTS = 3
const MAX_CHARS = 200

/** REFINEMENT_CHIPS: chip id → model-facing instruction (fixed English). */
export const CHIPS = {
  softer: 'make it softer',
  direct: 'make it more direct',
  shorter: 'make it shorter',
  playful: 'make it more playful',
}
const LABELS = {
  softer: 'refineSofter',
  direct: 'refineMoreDirect',
  shorter: 'refineShorter',
  playful: 'refineMorePlayful',
}
const isCustom = (r) => !Object.values(CHIPS).includes(r)

export const customLabel = (text) => (text.length > 20 ? `${text.slice(0, 20)}…` : text)

/** AdjustMenu's summary of the active adjustments. */
export function summary(refinements, t) {
  const id = (r) => Object.keys(CHIPS).find((k) => CHIPS[k] === r)
  return refinements.map((r) => (id(r) ? t(LABELS[id(r)]) : customLabel(r))).join(' · ')
}

const push = (stack, snap) => [...stack.slice(1 - MAX_UNDO), snap]

/** State { refinements, previousMain, stack } after adding `instruction` to
 * a result whose main is `main`, or null when it cannot be added. */
export function add(state, instruction, main, snap) {
  const r = state.refinements
  const text = instruction.trim().slice(0, MAX_CHARS)
  if (!text || r.length >= MAX_REFINEMENTS || r.includes(text) || (isCustom(text) && r.some(isCustom))) return null
  return { refinements: [...r, text], previousMain: main, stack: push(state.stack, snap) }
}

/** RefineRow's submitFreeform guard: a non-blank draft, below the cap,
 * with no custom adjustment active yet. */
export const canSubmit = (refinements, draft) =>
  Boolean(draft.trim()) && refinements.length < MAX_REFINEMENTS && !refinements.some(isCustom)

/** State after removing refinement `index`; previousMain is reset once
 * nothing is left to anchor (it would only fragment the cache). */
export function remove(state, index, main, snap) {
  const r = state.refinements
  if (!(index >= 0 && index < r.length)) return null
  const next = r.filter((_, i) => i !== index)
  return { refinements: next, previousMain: next.length ? main : '', stack: push(state.stack, snap) }
}

const empty = () => ({ refinements: [], previousMain: '', stack: [] })
const clone = (el) => [...el.childNodes].map((n) => n.cloneNode(true))

/**
 * Wire the refine row. `restore(live, nodes)` shows an earlier run again
 * (stream.js); `relabel(root)` applies the UI language to a detached node.
 * Sets app.refinements and app.refineFailed (stream.js asks it before
 * showing a server error). Returns { sync, edited, fill }.
 */
export function initRefine(app, form, restore, relabel) {
  const $ = (id) => document.getElementById(id)
  const ta = document.querySelector('[data-testid="input-textarea"]')
  const adjust = initAdjust(app, ta, relabel)
  const menu = adjust.menu
  const q = (id) => menu.querySelector(`[data-testid="${id}"]`)
  const row = menu.querySelector('.refine-row')
  const notice = q('refine-error')
  const chips = [...menu.querySelectorAll('[data-testid^="refine-chip-"]')]
  const customButton = q('refine-custom')
  const customTrigger = q('refine-custom-trigger')
  const editor = menu.querySelector('.refine-custom-editor')
  const input = q('refine-freeform')
  const apply = q('refine-apply')
  const details = $('result-details')
  const rows = $('learning-sentence')
  // Pill tones: the rendered class string, then data-active-class.
  // RefineRow's label: a bare text node after the Plus icon.
  const customLabelText = document.createTextNode('')
  customTrigger.append(customLabelText)
  const tones = new Map([...chips, customTrigger].map((b) => [b, [b.className, b.dataset.activeClass]]))
  let state = empty()
  let customOpen = false
  let error = null
  // A refine run is pending (TS refineInFlightRef); cleared by any finished
  // run, the rollback and input edits.
  let inFlight = false
  let seen = null
  let text = ta.value.trim()

  app.refinements = () => state.refinements

  /** A complete, current sentence result that refinements may act on. */
  const ready = () => {
    const live = app.live
    return Boolean(live?.done && !live.error && !app.pending && live.key === app.currentKey())
  }

  function sync() {
    const live = app.live
    const show = live?.intent === 'sentence' && !live.error?.input
    // TS unmounts the menu: RefineRow's draft and editor go with it.
    if (!show && menu.isConnected) {
      customOpen = false
      input.value = ''
    }
    adjust.show(show)
    if (live?.done && live.run !== seen) {
      seen = live.run
      error = null
      inFlight = false
    }
    const ok = ready()
    const r = state.refinements
    const cap = r.length >= MAX_REFINEMENTS
    const custom = r.find(isCustom)
    // RefineRow renders nothing while the result shows an error.
    row.hidden = Boolean(live?.error)
    for (const chip of chips) {
      const on = r.includes(CHIPS[chip.dataset.testid.slice(12)])
      chip.setAttribute('aria-pressed', on)
      chip.className = tones.get(chip)[+on]
      chip.disabled = !ok || (!on && cap)
    }
    customButton.hidden = !custom
    if (custom) {
      customButton.textContent = customLabel(custom)
      customButton.title = custom
      customButton.setAttribute('aria-label', `${app.t('refineRemove')}: ${custom}`)
      customButton.disabled = !ok
    }
    customTrigger.hidden = Boolean(custom)
    customTrigger.className = tones.get(customTrigger)[+customOpen]
    customTrigger.setAttribute('aria-expanded', customOpen)
    customTrigger.disabled = !ok || cap
    customLabelText.data = app.t('refineCustom')
    editor.hidden = input.hidden = Boolean(custom) || !customOpen
    input.disabled = !ok || cap
    apply.disabled = !ok || cap || !input.value.trim()
    notice.hidden = error === null
    // Separate text nodes (label, ": ", message): one node would move glyphs
    // by subpixels (the visual baselines show it).
    notice.replaceChildren(...(error === null ? [] : [app.t('refineFailed'), ': ', error]))
    adjust.sync({ summary: summary(r, app.t), error, refinements: r, intent: live?.intent, hasError: row.hidden })
  }

  /** Apply `fn` (add/remove) to the current result and re-run now. */
  function change(fn, arg) {
    const live = app.live
    if (!ready()) return false
    const { refinements, previousMain } = state
    // The snapshot keeps idle rows: no voice survives into it.
    app.stopSpeech()
    const next = fn(state, arg, live.main ?? '', {
      live, refinements, previousMain, details: clone(details), rows: clone(rows),
    })
    if (!next) return false
    state = next
    inFlight = true
    error = null
    app.run('refinement')
    return true
  }

  function submit() {
    // Before change(): a rejected draft must not stop speech.
    if (!canSubmit(state.refinements, input.value)) return
    if (change(add, input.value)) input.value = ''
  }

  menu.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    const id = button?.dataset.testid ?? ''
    const r = state.refinements
    if (id.startsWith('refine-chip-')) {
      const instruction = CHIPS[id.slice(12)]
      if (r.includes(instruction)) change(remove, r.indexOf(instruction))
      else change(add, instruction)
    } else if (id === 'refine-custom') {
      change(remove, r.findIndex(isCustom))
      customOpen = true
    } else if (id === 'refine-custom-trigger') {
      customOpen = !customOpen
      if (customOpen) requestAnimationFrame(() => input.focus())
    } else if (id === 'refine-apply') submit()
    else if (id === 'refine-close') {
      // AdjustMenu's onCloseCustom: the draft stays, focus returns to the
      // source.
      customOpen = false
      sync()
      adjust.closeCustom()
      return
    } else return
    sync()
  })
  menu.addEventListener('keydown', (event) => {
    if (event.target !== input || event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    submit()
    sync()
  })
  menu.addEventListener('input', sync)

  /** stream.js, before showing a server error: a failed refine instead
   * restores the result, refinements and previousMain it started from and
   * keeps a compact notice. */
  app.refineFailed = (message) => {
    const snap = state.stack.at(-1)
    if (!inFlight || !snap) return false
    state = { refinements: snap.refinements, previousMain: snap.previousMain, stack: state.stack.slice(0, -1) }
    inFlight = false
    error = message
    // RefineRow stays mounted (TS restores in the same commit as the
    // error): an open custom editor stays open with its draft.
    rows.replaceChildren(...snap.rows)
    // A Copy clicked before the refine was cloned while it said Copied.
    for (const node of snap.details)
      for (const button of node.querySelectorAll?.('[data-testid="copy-button"]') ?? [])
        showCopied(button, false, app.t)
    fill()
    restore(snap.live, snap.details)
    return true
  }

  /** The source text changed: refinements belonged to the old text. */
  function edited() {
    const now = ta.value.trim()
    if (now === text) return
    text = now
    state = empty()
    inFlight = false
    error = null
  }

  /** Copy refinements and previousMain into the run's hidden inputs. */
  function fill() {
    form.elements.previousMain.value = state.previousMain
    const [first, ...extra] = form.querySelectorAll('input[name="refinements"]')
    for (const el of extra) el.remove()
    first.value = state.refinements[0] ?? ''
    for (const value of state.refinements.slice(1).reverse()) {
      const el = first.cloneNode()
      el.value = value
      first.after(el)
    }
  }

  return { sync, edited, fill }
}
