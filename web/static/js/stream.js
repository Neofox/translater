// Result rendering from the /translate event stream.
//
// Hand-written: the nt-* events are this app's own protocol (go/internal/
// translate/events.go). htmx's hx-sse extension parses the stream and
// dispatches each named event on the form; partials (alternative rows) are
// swapped by htmx itself. Model text is always written with textContent.

import { transition } from './transition.js'

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/** End offsets of the graphemes of `text` that end after `from`. */
export function graphemeEnds(text, from) {
  const ends = []
  if (segmenter) {
    for (const { index, segment } of segmenter.segment(text)) {
      const end = index + segment.length
      if (end > from) ends.push(end)
    }
  } else {
    let i = 0
    for (const ch of text) {
      i += ch.length
      if (i > from) ends.push(i)
    }
  }
  return ends
}

/**
 * Interpolate provider bursts on grapheme boundaries for at most `burstMs`
 * (useStreamingText.ts). `write(shown)` receives every displayed prefix.
 * Display only: callers keep the real text for Copy and readiness.
 */
export function createInterpolator(write, {
  burstMs = 100,
  now = () => performance.now(),
  frame = (cb) => requestAnimationFrame(cb),
  cancel = (id) => cancelAnimationFrame(id),
  immediate = () => false,
} = {}) {
  let full = ''
  let shown = ''
  let id = 0
  const show = (text) => {
    if (text === shown) return
    shown = text
    write(text)
  }
  const stop = () => {
    if (id) cancel(id)
    id = 0
  }
  return {
    get text() {
      return shown
    },
    /** New target text; animates the added graphemes. */
    set(text) {
      full = text
      stop()
      if (immediate() || !text.startsWith(shown)) {
        show(text)
        return
      }
      const ends = graphemeEnds(text, shown.length)
      if (!ends.length) return
      const started = now()
      const tick = () => {
        const progress = Math.min(1, (now() - started) / burstMs)
        const n = Math.max(1, Math.ceil(ends.length * progress))
        show(full.slice(0, ends[n - 1]))
        id = progress < 1 ? frame(tick) : 0
      }
      id = frame(tick)
    },
    /** Stop animating and keep the text shown so far. */
    halt() {
      stop()
      full = shown
    },
    /** Show everything now (main ready, done, focus, selection). */
    flush(text = full) {
      full = text
      stop()
      show(text)
    },
    reset() {
      full = ''
      stop()
      show('')
    },
  }
}

/** Only the current, still-running run may change the result: events of a
 * superseded run that were already in flight are dropped. */
export function accepts(live, data) {
  return Boolean(live && data && live.run === data.run && !live.aborted && !live.error)
}

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Listen for nt-* events on `form`. `app.live` is the current run; events of
 * any other run are ignored, so a superseded stream cannot touch the result.
 */
export function initStream(app, form) {
  const $ = (id) => document.getElementById(id)
  const main = $('main-translation')
  const mainText = document.createTextNode('')
  const cursor = document.createElement('span')
  cursor.className = 'result-cursor animate-pulse'
  cursor.setAttribute('aria-hidden', 'true')
  main.replaceChildren(mainText)
  const content = $('result-content')
  const empty = $('result-empty')
  const errorBox = $('result-error')
  const details = $('result-details')
  const learningRows = $('learning-sentence')
  const explanation = $('main-explanation')
  const panel = document.querySelector('.output-panel')
  const status = $('result-status')

  // SentenceView/WordView mark result-details while alternative rows exist
  // and mount the section only then (the server sends it hidden); htmx
  // swaps the rows in, so follow them.
  new MutationObserver(() => {
    const has = details.querySelector('.alternative-item')
    details.classList.toggle('has-alternatives', Boolean(has))
    details.querySelector('.detail-alternatives')?.toggleAttribute('hidden', !has)
  }).observe(details, { childList: true, subtree: true })

  const interp = createInterpolator((text) => {
    mainText.data = text
  }, { immediate: reduced })

  // OutputPanel's placeholder for a run with no main text to show.
  const dots = document.createElement('span')
  dots.className = 'text-ink-dim'
  dots.textContent = '…'
  const scroll = $('translation-result')
  const hint = $('result-error-hint')
  const actions = errorBox.querySelector('.state-actions')
  const retryLabel = document.createTextNode('')
  actions.querySelector('.retry-button').append(retryLabel)

  /** The streaming cursor until main is ready; `…` when nothing shows. */
  function setMarks(live, streaming) {
    const waiting = Boolean(live && streaming && !live.mainReady)
    if (waiting) main.append(cursor)
    else cursor.remove()
    if (live && !waiting && !interp.text) main.append(dots)
    else dots.remove()
  }

  function renderExplanation() {
    const live = app.live
    const rationale = live?.rationale ?? ''
    const formality = live?.formality ?? ''
    const streaming = Boolean(live && app.streaming())
    const show = Boolean(live && !live.error && (rationale || formality || streaming))
    explanation.hidden = !show
    if (!show) return
    const title = app.t(live.intent === 'sentence' ? 'whyWording' : 'usage')
    explanation.setAttribute('aria-label', title)
    explanation.querySelector('h3').textContent = title
    const skeleton = explanation.querySelector('.main-explanation-skeleton')
    const p = explanation.querySelector('p')
    skeleton.hidden = Boolean(rationale || formality)
    p.hidden = !skeleton.hidden
    if (p.hidden) return
    const parts = []
    if (live.register) {
      const tag = document.createElement('span')
      tag.className = 'section-tag'
      tag.lang = 'ko'
      tag.textContent = live.register
      parts.push(tag)
    }
    for (const [id, text] of [['explanation-rationale', rationale], ['explanation-formality', formality]]) {
      if (!text) continue
      if (parts.length > (live.register ? 1 : 0)) parts.push(' ')
      const span = document.createElement('span')
      span.id = id
      span.textContent = text
      parts.push(span)
    }
    p.replaceChildren(...parts)
  }

  function renderState() {
    const live = app.live
    const streaming = app.streaming()
    panel?.setAttribute('aria-busy', String(streaming))
    const { source, target } = app.prefs
    status.dataset.t = source !== 'auto' && source === target ? 'polishing' : 'streaming'
    status.textContent = app.t(status.dataset.t)
    status.hidden = !streaming
    app.setSwapBusy(streaming)
    errorBox.hidden = !live?.error
    content.hidden = !live || Boolean(live.error)
    empty.hidden = Boolean(live) || app.pending
    setMarks(live, streaming)
    renderExplanation()
    app.updateActions()
  }

  /** Start rendering a new run: no placeholder text in main. */
  function start(live) {
    interp.reset()
    main.lang = live.target
    main.classList.toggle('result-word', live.intent === 'word')
    // A word's main text is the word-details trigger's text
    // (InspectableTranslation's actionLabel branch); dictionary.js keeps
    // its state.
    if (live.intent === 'word') {
      const trigger = document.createElement('button')
      trigger.type = 'button'
      trigger.className = 'word-details-trigger'
      trigger.dataset.testid = 'word-details-trigger'
      trigger.disabled = true
      trigger.append(mainText)
      main.replaceChildren(trigger)
    } else main.replaceChildren(mainText)
    details.replaceChildren()
    // The previous run's breakdown rows go too (its nt-learning stays with it).
    learningRows.replaceChildren()
    renderState()
  }

  function clear() {
    interp.reset()
    details.replaceChildren()
    renderState()
  }

  /** Show an earlier, finished sentence run again (refine rollback);
   * `nodes` are the #result-details children it had. */
  function restore(live, nodes) {
    app.live = live
    main.lang = live.targetLang ?? live.target
    main.replaceChildren(mainText)
    details.replaceChildren(...nodes)
    interp.flush(live.main)
    renderState()
  }

  /** Freeze an aborted run's main where it is: nothing more appears. Its
   * completed alternative rows stay; the pending one's skeleton goes. */
  function stop() {
    interp.halt()
    $('alternative-skeleton')?.remove()
    renderState()
  }

  /** Show the current run's error. An input error brings its own hint; a
   * server error (no hint) shows errorEnvHint and Retry, inside the result
   * transition. */
  function showError(message, inputHint) {
    const live = app.live
    const server = inputHint === undefined
    // A failed refinement rolls back instead (refine.js).
    if (server && app.refineFailed?.(message)) return
    // TS keeps no live result for an input error.
    live.error = { message, input: !server }
    const show = () => {
      if (app.live !== live) return
      interp.reset()
      details.replaceChildren()
      errorBox.querySelector('.state-title').textContent = app.t('translationFailedTitle')
      errorBox.querySelector('.state-body').textContent = message
      hint.textContent = server ? app.t('errorEnvHint') : inputHint
      hint.hidden = false
      actions.hidden = !server
      retryLabel.data = app.t('retry')
      renderState()
    }
    if (server) transition(scroll, show)
    else show()
  }

  const handlers = {
    'nt-source-lang'(live, d) {
      live.sourceLang = d.lang
      app.sourceReported(live)
    },
    // The main text's lang and the Listen language follow the report too.
    'nt-target-lang'(live, d) {
      live.targetLang = d.lang
      main.lang = d.lang
      app.targetReported(live)
      renderExplanation()
    },
    'nt-headword'(live, d) {
      live.headword = d.text
    },
    'nt-main-delta'(live, d) {
      live.raw += d.text
      if (!live.mainReady) interp.set(live.raw.trimStart())
    },
    'nt-main-ready'(live, d) {
      live.main = d.main
      live.mainReady = d.main !== ''
      interp.flush(d.main)
      renderState()
    },
    // The sentence's learning ranges (learning.js shows them once done).
    'nt-learning'(live, d) {
      live.learning = d
    },
    'nt-text-delta'(live, d) {
      const key = d.field === 'formalityNote' ? 'formality' : 'rationale'
      live[key] += d.text
      renderExplanation()
    },
    'nt-done'(live) {
      live.done = true
      app.pending = false
      live.main ??= live.raw.trim()
      // Only the settled result transitions; deltas never wait for one.
      transition(scroll, () => {
        if (app.live !== live) return
        interp.flush(live.main)
        renderState()
      })
      app.sourceDone(live)
    },
    'nt-error'(live, d) {
      app.pending = false
      showError(d.message)
    },
  }
  for (const [name, handle] of Object.entries(handlers)) {
    form.addEventListener(name, (event) => {
      let data
      try {
        data = JSON.parse(event.detail.data)
      } catch {
        return
      }
      const live = app.live
      if (accepts(live, data)) handle(live, data)
    })
  }

  // Drop unnamed messages (partials) of an aborted request: hx-sse awaits each
  // swap, so messages already read from an old chunk could otherwise land in
  // the new result.
  form.addEventListener('htmx:sse:before:message', (event) => {
    if (event.detail.connection?.abortController?.signal?.aborted) event.detail.cancelled = true
  })

  const failed = (event) => {
    const run = event.detail?.ctx?.request?.body?.get?.('run')
    const live = app.live
    if (!live || live.run !== run || live.aborted || live.done || live.error) return
    app.pending = false
    showError(app.t('translationFailed'))
  }
  form.addEventListener('htmx:response:error', failed)
  form.addEventListener('htmx:error', (event) => {
    if (event.detail?.error?.name === 'AbortError') return
    failed(event)
  })
  // A stream that ends without nt-done or nt-error failed mid-way.
  form.addEventListener('htmx:finally:request', failed)

  // Reveal the whole main text on interaction (useStreamingText).
  const reveal = () => {
    if (app.live?.mainReady || app.live?.done) return
    interp.flush()
  }
  $('translation-result')?.addEventListener('focusin', reveal)
  main.addEventListener('pointerdown', reveal)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reveal()
  })

  return { start, clear, stop, restore, showError, renderState, renderExplanation }
}
