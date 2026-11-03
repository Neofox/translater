// Word dictionary (WordSourceMeta.tsx state) and the word parts of the
// reference pane (its placement, and InspectableTranslation's word trigger
// state; learning.js handles activation).
//
// Hand-written: the active POS tab is client state the server cannot know.
// The server renders one block variant per POS into #word-meta (inactive
// ones `hidden`); this module shows the active variant again after every
// swap. Handlers are delegated on document.

import { SEPARATE } from './learning.js'

// PosTabs' class strings (go/internal/web/dictionary.templ).
const TAB_ON = 'cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition border-accent/60 bg-accent-soft text-ink'
const TAB_OFF = 'cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition border-border bg-panel text-ink-soft hover:text-ink'
// The POS tabs are the first block's buttons (only PosTabs has mb-4, see
// TestOnlyPosTabsBlockIsMb4); the synonyms are the other buttons.
const TABS = '.word-source-meta > .mb-4 > button'

/** The active tab after a swap: it persists within a run, and resets on a
 * new run or when it is past the POS list (WordSourceMeta's effect). */
export function nextActive(state, run, count) {
  if (state.run !== run || state.active >= Math.max(count, 1)) return { run, active: 0 }
  return state
}

export const selectTab = (state, active) => ({ ...state, active })

/** `composer.setText` performs synonym lookups. Returns { sync }: call it
 * whenever the run, its state or the layout changes. */
export function initDictionary(app, composer) {
  const $ = (selector) => document.querySelector(selector)
  const meta = $('#word-meta')
  const panel = meta.closest('.reference-panel')
  const dock = panel.parentElement
  const inputPanel = $('.input-panel')
  const main = $('#main-translation')
  let state = { run: null, active: 0 }
  let shownRun = null

  const set = (el, name, value) => {
    if (value === null) {
      if (el.hasAttribute(name)) el.removeAttribute(name)
    } else if (el.getAttribute(name) !== value) el.setAttribute(name, value)
  }

  // Idempotent: it runs again for its own mutations and then changes nothing.
  function apply() {
    const tabs = [...meta.querySelectorAll(TABS)]
    state = nextActive(state, app.live?.run ?? null, tabs.length)
    tabs.forEach((tab, i) => set(tab, 'class', i === state.active ? TAB_ON : TAB_OFF))
    for (const block of meta.querySelectorAll('[data-pos]')) set(block, 'hidden', +block.dataset.pos === state.active ? null : '')
  }
  new MutationObserver(apply).observe(meta, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'],
  })

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    const button = target?.closest('.word-source-meta button')
    if (!button || button.disabled) return
    if (button.matches(TABS)) {
      state = selectTab(state, [...button.parentElement.children].indexOf(button))
      apply()
    } else composer.setText(button.textContent, { focus: true })
  })

  function sync() {
    const live = app.live
    const word = Boolean(live && !live.error && live.intent === 'word')
    const layout = app.layout.layout()
    const separate = SEPARATE.includes(layout.mode)
    // A new run starts from an empty dictionary until its first partial.
    if (live?.run !== shownRun) {
      shownRun = live?.run
      meta.replaceChildren()
    }
    // A stopped run keeps what it received; TS drops the skeleton once
    // nothing streams, and renders nothing when nothing was received.
    if (live && !app.streaming()) {
      for (const pulse of meta.querySelectorAll('.animate-pulse')) pulse.closest('.word-source-meta > *')?.remove()
      const box = meta.querySelector('.word-source-meta')
      if (box && !box.children.length) box.remove()
    }
    // TS mounts the pane only then (and not under an open learning
    // surface); base.css selects on its presence, so it waits in a hidden
    // dock otherwise. learning.js writes its heading.
    const home = word && separate && !app.learning.panelOpen() ? inputPanel : dock
    if (panel.parentElement !== home) home.append(panel)

    const trigger = main.querySelector('.word-details-trigger')
    const canOpen = Boolean(trigger && app.learning.canOpen())
    set(main, 'data-inspectable', canOpen ? 'true' : null)
    if (!trigger) return
    trigger.disabled = !canOpen
    set(trigger, 'aria-label', `${app.t('wordDetails')}: ${live?.raw ?? ''}`)
  }

  return { sync }
}
