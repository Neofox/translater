// Learning: LearningContext/useLearning state over the initial translation
// response, LearningInspector.tsx's rows, InspectableTranslation.tsx's
// main-text phrases, SourceHighlight.tsx's mirror under the source, the
// word-details activation, LearningPanel.tsx (the mobile surface),
// ReferencePanel.tsx's heading and the `inert` background of
// InputPanel/OutputPanel.
//
// Hand-written: this is the app's own learning state machine over
// server-rendered markup (no library models it). The server sends a
// sentence's rows (#learning-sentence) and `nt-learning` ranges (UTF-16
// offsets, no text) just before nt-done; everything shown here derives from
// them, the current run and the textarea value, so phrase inspection is
// local page state only and is never stored or sent. Handlers are delegated
// on document, so swapped or moved nodes need no rebinding. Taps on the main
// text and the source grammar come from inspect.js.

import { initMainTaps, initSourceTaps } from './inspect.js'

/** Layouts with a reference pane beside the source (TranslatorWorkspace). */
export const SEPARATE = ['workspace', 'split', 'book']

/** The state resets whenever its identity (the run, whether its result can
 * open, and whether its learning still matches the source) changes:
 * LearningContext's wordIdentity effect and useLearning's identity. */
export function reconcile(state, identity) {
  return state.identity === identity ? state : { ...state, identity, open: false, chunk: null }
}

/** A trigger activation (OutputPanel's word onInspect): it closes an open
 * surface where there is no reference pane, otherwise it opens and counts,
 * so the reference heading takes focus on every activation. */
export function activate(state, { canOpen, separate }) {
  if (!canOpen) return state
  if (state.open && !separate) return { ...state, open: false }
  return { ...state, open: true, activation: state.activation + 1 }
}

/** A row click (useLearning's selectChunk): learning opens on that phrase,
 * or stays open with none expanded when the row collapses. */
export function selectChunk(state, chunk) {
  return { ...state, open: true, chunk }
}

// Pieces of [from, to) with each range clipped to it and a range starting
// before the end of the previous one skipped (the TS renderers' rule).
function plain(out, from, to, ranges, kind) {
  let cursor = from
  for (const [s, e] of ranges) {
    const start = Math.max(from, s)
    const end = Math.min(to, e)
    if (start >= end || start < cursor) continue
    if (start > cursor) out.push({ from: cursor, to: start, kind: 'text' })
    out.push({ from: start, to: end, kind })
    cursor = end
  }
  if (to > cursor) out.push({ from: cursor, to, kind: 'text' })
}

/** Main text pieces (InspectableTranslation's renderText): grammar
 * `highlights` as 'phrase', the `selected` chunk as one 'selected' piece. */
export function mainSegments(length, highlights, selected) {
  const out = []
  if (!selected) {
    plain(out, 0, length, highlights, 'phrase')
    return out
  }
  plain(out, 0, selected[0], highlights, 'phrase')
  out.push({ from: selected[0], to: selected[1], kind: 'selected' })
  plain(out, selected[1], length, highlights, 'phrase')
  return out
}

/** Source mirror pieces (SourceHighlight's renderPlain): highlighted
 * `spans` as 'mark' in start order, `grammar` between them as 'grammar'. */
export function mirrorSegments(length, spans, grammar) {
  const out = []
  let cursor = 0
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (s < cursor) continue
    plain(out, cursor, s, grammar, 'grammar')
    out.push({ from: s, to: e, kind: 'mark' })
    cursor = e
  }
  plain(out, cursor, length, grammar, 'grammar')
  return out
}

/** The mirror copies these from the textarea so its text wraps the same. */
const MIRRORED = ['font', 'letter-spacing', 'line-height', 'padding', 'border-width', 'box-sizing', 'text-align', 'word-break', 'overflow-wrap', 'tab-size']

/** Returns { sync, canOpen, panelOpen, ready }. `sync` runs whenever the
 * run, its state, the source or the layout changes, before dictionary.js
 * places the pane. */
export function initLearning(app) {
  const $ = (selector) => document.querySelector(selector)
  const panel = $('.learning-panel')
  const body = panel.querySelector('.learning-panel-body')
  const title = panel.querySelector('h2')
  const inspector = $('#learning-inspector')
  const home = inspector.parentElement
  const reference = home.closest('.reference-panel')
  const heading = reference.querySelector('.reference-heading')
  const sentence = $('#learning-sentence')
  const meta = $('#word-meta')
  const main = $('#main-translation')
  // stream.js writes the main text into this node; decorating main detaches
  // it until the decoration goes or the next run starts.
  const mainText = main.firstChild
  const ta = $('[data-testid="input-textarea"]')
  const background = ['.input-panel', '.target-toolbar', '.result-scroll'].map($)
  let state = { identity: '', open: false, activation: 0, chunk: null }
  let shown = false
  let decorated = ''
  let mirror = null
  let mirrored = ''
  let scrolledTo = null
  // The editor state when learning opened from a source grammar tap
  // (LearningContext's sourceFocus), restored when the surface closes.
  let saved = null

  /** The current, finished, error-free result (LearningContext's canOpen). */
  const canOpen = () => {
    const live = app.live
    return Boolean(live?.done && !app.pending && !live.error && live.raw && live.key === app.currentKey())
  }
  /** The current sentence's learning, while the source is exactly the text
   * its ranges were computed on. */
  const learning = () => {
    const live = app.live
    const ranges = live?.learning
    return ranges && live.intent === 'sentence' && canOpen() && ta.value === live.input ? ranges : null
  }
  const layout = () => app.layout.layout()
  const rows = () => [...sentence.querySelectorAll('[data-testid="learning-chunk"]')]
  // The chunk index, kept when punctuation-only rows are skipped.
  const indexOf = (row) => Number(row.getAttribute('aria-controls').split('-').pop())

  function setOpen(open) {
    shown = open
    for (const el of background) el.inert = open
    panel.hidden = !open
    if (open) {
      panel.dataset.expanded = 'true'
      body.append(inspector)
      panel.querySelector('button').focus({ preventScroll: true })
    } else {
      delete panel.dataset.expanded
      home.append(inspector)
      // LearningPanel's close effect: the exact editor state when opened from
      // the source and the result is unchanged, else the trigger or the main
      // text (a disabled trigger keeps focus where it is).
      const source = saved
      saved = null
      if (source?.identity === state.identity && ta.isConnected) {
        ta.focus({ preventScroll: true })
        ta.setSelectionRange(source.start, source.end, source.direction)
        ta.scrollTop = source.top
        ta.scrollLeft = source.left
      } else (main.querySelector('.word-details-trigger') ?? main).focus({ preventScroll: true })
    }
  }

  function set(el, name, value) {
    if (value === null) el.removeAttribute(name)
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value)
  }

  /** Main text pieces as text, inspectable phrases and the selected mark. */
  function decorate(segments) {
    if (!segments.some((piece) => piece.kind !== 'text')) return undecorate()
    const key = JSON.stringify(segments)
    if (decorated === key && !mainText.isConnected) return
    const text = mainText.data
    main.replaceChildren(...segments.map(({ from, to, kind }) => {
      const slice = text.slice(from, to)
      if (kind === 'text') return slice
      const el = document.createElement(kind === 'selected' ? 'mark' : 'span')
      el.className = kind === 'selected' ? 'learning-highlight' : 'inspectable-phrase'
      el.dataset.testid = kind === 'selected' ? 'selected-phrase' : 'inspectable-phrase'
      if (kind === 'phrase') el.dataset.start = from
      el.textContent = slice
      return el
    }))
    decorated = key
  }
  function undecorate() {
    if (decorated && !mainText.isConnected) main.replaceChildren(mainText)
    decorated = ''
  }

  /** Mirror styles and scroll follow the textarea (SourceHighlight). */
  function syncMirror() {
    if (!mirror) return
    const style = getComputedStyle(ta)
    for (const property of MIRRORED) mirror.style.setProperty(property, style.getPropertyValue(property))
    mirror.scrollTop = ta.scrollTop
    mirror.scrollLeft = ta.scrollLeft
  }
  function renderMirror(spans, grammar) {
    if (!spans.length && !grammar.length) {
      mirror?.remove()
      mirror = null
      mirrored = ''
      return
    }
    const text = ta.value
    const key = JSON.stringify([text, spans, grammar])
    if (!mirror) {
      mirror = document.createElement('div')
      mirror.className = 'source-highlight'
      mirror.setAttribute('aria-hidden', 'true')
      mirror.dataset.testid = 'source-highlight'
      ta.before(mirror)
    }
    if (mirrored !== key) {
      mirrored = key
      const parts = mirrorSegments(text.length, spans, grammar).map(({ from, to, kind }) => {
        const slice = text.slice(from, to)
        if (kind === 'text') return slice
        const el = document.createElement(kind === 'mark' ? 'mark' : 'span')
        el.className = kind === 'mark' ? 'learning-highlight' : 'source-grammar'
        if (kind === 'grammar') {
          el.dataset.testid = 'source-grammar'
          el.dataset.sourceStart = from
        }
        el.textContent = slice
        return el
      })
      mirror.replaceChildren(...parts, '​')
    }
    syncMirror()
  }

  /** Rows: one expanded at a time, scrolled into view in its pane. */
  function renderRows(ranges) {
    sentence.hidden = !ranges
    for (const row of rows()) {
      const open = Boolean(ranges) && indexOf(row) === state.chunk
      set(row, 'aria-expanded', String(open))
      set(row.firstElementChild, 'class', open ? 'learning-phrase' : null)
      const detail = document.getElementById(row.getAttribute('aria-controls'))
      if (detail) detail.hidden = !open
    }
    const selected = ranges && state.chunk !== null ? state.chunk : null
    if (selected === scrolledTo) return
    scrolledTo = selected
    const row = sentence.querySelector('[aria-expanded="true"]')
    const scroll = row?.closest('.reference-scroll, .learning-panel-body')
    if (!row || !scroll) return
    const top = row.getBoundingClientRect().top - scroll.getBoundingClientRect().top
    if (top < 0 || top > scroll.clientHeight - row.offsetHeight) scroll.scrollTop += top
  }

  /** InspectableTranslation's sentence state: target-side grammar phrases
   * and the selected chunk, `data-inspectable` and, on mobile, the
   * whole-text button semantics. Words keep their trigger (dictionary.js). */
  function renderMain(ranges, desktop) {
    if (app.live?.intent === 'word') {
      set(main, 'tabindex', '-1')
      set(main, 'role', null)
      set(main, 'aria-expanded', null)
      return undecorate()
    }
    const side = ranges?.side
    const disabled = !ranges || (desktop && side === 'source')
    const target = !disabled && side === 'target'
    const chunk = target && state.chunk !== null ? ranges.chunks[state.chunk] : null
    const highlights = target ? ranges.chunks.flatMap((c) => c.g) : []
    const whole = !disabled && !desktop
    set(main, 'data-inspectable', whole || highlights.length ? 'true' : null)
    set(main, 'tabindex', whole ? '0' : '-1')
    set(main, 'role', whole ? 'button' : null)
    set(main, 'aria-expanded', whole ? String(state.open) : null)
    decorate(disabled ? [] : mainSegments(mainText.data.length, highlights, chunk && [chunk.s, chunk.e]))
  }

  function sync() {
    const live = app.live
    const { mode, desktop } = layout()
    const ranges = learning()
    state = reconcile(state, `${live?.run ?? ''}:${canOpen()}:${Boolean(ranges)}`)
    if (state.chunk !== null && !ranges?.chunks[state.chunk]) state = { ...state, chunk: null }
    const word = live?.intent === 'word'
    const wordOpen = word && state.open
    if (state.open && !desktop) {
      if (!shown) setOpen(true)
    } else if (shown) setOpen(false)
    // LearningPanel's heading names the selected phrase.
    const row = rows().find((r) => ranges && indexOf(r) === state.chunk)
    title.textContent = app.t('learn') + (row ? ` · ${row.firstElementChild.textContent}` : '')
    heading.textContent = wordOpen
      ? `${app.t('wordDetails')} · ${live.headword ?? ''}`
      : app.t(desktop ? (word ? 'wordDetails' : 'breakdown') : 'learn')
    if (wordOpen) reference.dataset.wordActive = 'true'
    else delete reference.dataset.wordActive
    const trigger = main.querySelector('.word-details-trigger')
    trigger?.setAttribute('aria-expanded', String(SEPARATE.includes(mode) || state.open))
    // LearningInspector renders only the section of the result's intent.
    meta.hidden = !word
    renderRows(ranges)
    renderMain(ranges, desktop)
    // InputPanel: source grammar before any selection when learning the
    // original source; the selected chunk itself there, or its counterpart
    // quotations when learning the translation.
    const selected = ranges && state.chunk !== null ? ranges.chunks[state.chunk] : null
    const source = ranges?.side === 'source'
    renderMirror(
      selected ? (source ? [[selected.s, selected.e]] : selected.src) : [],
      source ? ranges.chunks.flatMap((c) => c.g) : [],
    )
  }

  function close() {
    if (!state.open) return
    state = { ...state, open: false, chunk: null }
    app.updateActions()
  }

  /** LearningContext's openAt: learning opens on the phrase containing
   * `offset` (none for the overview). A source grammar tap keeps the exact
   * editor state for the close. */
  function openAt(offset, origin) {
    const ranges = learning()
    if (!ranges) return
    saved = origin === 'source' ? { start: ta.selectionStart, end: ta.selectionEnd, direction: ta.selectionDirection, top: ta.scrollTop, left: ta.scrollLeft, identity: state.identity } : null
    const index = offset === undefined ? -1 : ranges.chunks.findIndex((c) => offset >= c.s && offset < c.e)
    state = { ...state, open: true, chunk: index < 0 ? null : index }
    // On mobile the surface replaces the editor, so its keyboard goes.
    if (origin === 'source' && !layout().desktop) ta.blur()
    app.updateActions()
  }

  /** The word trigger's activation (OutputPanel's word onInspect). */
  function activateWord() {
    const { mode, desktop } = layout()
    state = activate(state, { canOpen: canOpen(), separate: SEPARATE.includes(mode) })
    app.updateActions()
    // ReferencePanel's effect: the heading takes focus on every activation.
    if (desktop && state.open) {
      heading.focus({ preventScroll: true })
      home.scrollTo({ top: 0 })
    }
  }

  /** A main text tap at `offset` (OutputPanel's sentence onInspect). When
   * learning the original source, the tapped translation maps to the phrase
   * whose counterpart quotation contains it, else to the overview. */
  function inspectMain(offset) {
    if (app.live?.intent === 'word') return activateWord()
    const ranges = learning()
    if (!ranges) return
    if (!layout().desktop && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    if (ranges.side !== 'source') return openAt(offset)
    const chunk = ranges.chunks.find((c) => c.src.some(([s, e]) => offset >= s && offset < e))
    openAt(chunk?.s)
  }

  initMainTaps({ key: () => state.identity, onInspect: inspectMain })
  initSourceTaps(ta, {
    mirror: () => (learning()?.side === 'source' ? mirror : null),
    key: () => state.identity,
    onInspect: (offset) => openAt(offset, 'source'),
  })

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.learning-panel-header button')) return close()
    const row = target?.closest('#learning-sentence [data-testid="learning-chunk"]')
    if (row) {
      const ranges = learning()
      const index = indexOf(row)
      if (!ranges?.chunks[index]) return
      state = selectChunk(state, row.getAttribute('aria-expanded') === 'true' ? null : index)
      app.updateActions()
      return
    }
    // Keyboard clicks only: pointer taps go through the selection-safe
    // gesture of inspect.js.
    const trigger = target?.closest('.word-details-trigger')
    if (trigger && !trigger.disabled && event.detail === 0) activateWord()
  })
  document.addEventListener('keydown', (event) => {
    const target = event.target instanceof Element ? event.target : null
    // The mobile main text is a button that opens learning.
    if ((event.key === 'Enter' || event.key === ' ') && target === main && main.getAttribute('role') === 'button' && main.dataset.inspectable === 'true') {
      event.preventDefault()
      return inspectMain(0)
    }
    if (event.key !== 'Escape' || !shown || !target?.closest('.output-panel')) return
    event.stopPropagation()
    close()
  })
  window.addEventListener('pagehide', close)
  ta.addEventListener('scroll', syncMirror, { passive: true })
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncMirror).observe(ta)

  return { sync, canOpen, panelOpen: () => shown, ready: () => Boolean(learning()) }
}
