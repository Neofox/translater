// Word-details activation and the mobile learning surface: LearningContext's
// word state, LearningPanel.tsx, ReferencePanel.tsx's heading and the
// `inert` background of InputPanel/OutputPanel. Task 19 adds the sentence
// path.
//
// Hand-written: this is the app's own learning state machine over
// server-rendered markup (no library models it). Handlers are delegated on
// document, so swapped or moved nodes need no rebinding.

const SEPARATE = ['workspace', 'split', 'book']

/** The word state resets whenever its identity (the run, and whether its
 * result can open) changes (LearningContext's wordIdentity effect). */
export function reconcile(state, identity) {
  return state.identity === identity ? state : { ...state, identity, open: false }
}

/** A trigger activation (OutputPanel's word onInspect): it closes an open
 * surface where there is no reference pane, otherwise it opens and counts,
 * so the reference heading takes focus on every activation. */
export function activate(state, { canOpen, separate }) {
  if (!canOpen) return state
  if (state.open && !separate) return { ...state, open: false }
  return { ...state, open: true, activation: state.activation + 1 }
}

/** Returns { sync, canOpen, panelOpen }. `sync` runs whenever the run, its
 * state or the layout changes, before dictionary.js places the pane. */
export function initLearning(app) {
  const $ = (selector) => document.querySelector(selector)
  const panel = $('.learning-panel')
  const body = panel.querySelector('.learning-panel-body')
  const title = panel.querySelector('h2')
  const inspector = $('#learning-inspector')
  const home = inspector.parentElement
  const reference = home.closest('.reference-panel')
  const heading = reference.querySelector('.reference-heading')
  const main = $('#main-translation')
  const background = ['.input-panel', '.target-toolbar', '.result-scroll'].map($)
  let state = { identity: '', open: false, activation: 0 }
  let shown = false

  /** The current, finished, error-free result (LearningContext's canOpen). */
  const canOpen = () => {
    const live = app.live
    return Boolean(live?.done && !app.pending && !live.error && live.raw && live.key === app.currentKey())
  }
  const layout = () => app.layout.layout()

  function setOpen(open) {
    shown = open
    for (const el of background) el.inert = open
    panel.hidden = !open
    if (open) {
      panel.dataset.expanded = 'true'
      title.textContent = app.t('learn')
      body.append(inspector)
      panel.querySelector('button').focus({ preventScroll: true })
    } else {
      delete panel.dataset.expanded
      home.append(inspector)
      // LearningPanel's close effect; a disabled trigger keeps focus where it is.
      ;(main.querySelector('.word-details-trigger') ?? main).focus({ preventScroll: true })
    }
  }

  function sync() {
    const live = app.live
    const { mode, desktop } = layout()
    state = reconcile(state, `${live?.run ?? ''}:${canOpen()}`)
    const word = live?.intent === 'word'
    const wordOpen = word && state.open
    if (state.open && !desktop) {
      if (!shown) setOpen(true)
    } else if (shown) setOpen(false)
    heading.textContent = wordOpen
      ? `${app.t('wordDetails')} · ${live.headword ?? ''}`
      : app.t(desktop ? (word ? 'wordDetails' : 'breakdown') : 'learn')
    if (wordOpen) reference.dataset.wordActive = 'true'
    else delete reference.dataset.wordActive
    const trigger = main.querySelector('.word-details-trigger')
    trigger?.setAttribute('aria-expanded', String(SEPARATE.includes(mode) || state.open))
  }

  function close() {
    if (!state.open) return
    state = { ...state, open: false }
    app.updateActions()
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.learning-panel-header button')) return close()
    const trigger = target?.closest('.word-details-trigger')
    if (!trigger || trigger.disabled) return
    // Until the selection-safe tap of Task 20, any click activates (TS:
    // keyboard clicks here, pointer taps after a 400 ms grace period).
    const { mode, desktop } = layout()
    state = activate(state, { canOpen: canOpen(), separate: SEPARATE.includes(mode) })
    app.updateActions()
    // ReferencePanel's effect: the heading takes focus on every activation.
    if (desktop && state.open) {
      heading.focus({ preventScroll: true })
      home.scrollTo({ top: 0 })
    }
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !shown || !event.target.closest?.('.output-panel')) return
    event.stopPropagation()
    close()
  })
  window.addEventListener('pagehide', close)

  return { sync, canOpen, panelOpen: () => shown }
}
