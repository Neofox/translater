// Inspection gestures: phrasePointer.ts (isInspectTap, textOffsetAtPoint),
// InspectableTranslation.tsx's pointer handlers on the main text and
// SourceHighlight.tsx's grammar hit-testing on the source editor.
//
// Hand-written: no library implements these selection-safe tap rules or the
// hit-testing of an inert mirror under a native textarea. A short stationary
// tap inspects only after GRACE_MS, so native double-click, long-press and
// drag selection win first. Nothing here prevents a native default or covers
// the editor: the source keeps its node, focus, caret and IME composition.

/** Native selection gets this long to start before a tap inspects. */
export const GRACE_MS = 400

/** A tap: under 350 ms, moving under 8 px, leaving no selection. */
export function isInspectTap(start, end, selection) {
  return end.time - start.time < 350 && Math.hypot(end.x - start.x, end.y - start.y) < 8 && !selection
}

/** The UTF-16 text offset of point (x, y) inside `root`, or null. */
export function textOffsetAtPoint(root, x, y) {
  const doc = root.ownerDocument
  const caret = doc.caretPositionFromPoint?.(x, y)
  const fallback = caret ? null : doc.caretRangeFromPoint?.(x, y)
  const node = caret?.offsetNode ?? fallback?.startContainer
  const offset = caret?.offset ?? fallback?.startOffset
  if (!node || offset === undefined || !root.contains(node)) return null
  const range = doc.createRange()
  range.setStart(root, 0)
  range.setEnd(node, offset)
  return range.toString().length
}

const point = (event) => ({ x: event.clientX, y: event.clientY, time: performance.now() })
const pageSelection = () => window.getSelection()?.toString() ?? ''
const MAIN = '[data-testid="main-translation"]'

/** Main text taps (InspectableTranslation). `key()` names the current result
 * state: a timer from another state never fires (TS resets on text,
 * disabled and resetKey). The main text is interactive while it carries
 * `data-inspectable`; its `role=button` form inspects anywhere, otherwise a
 * tap must land inside one of the `hits()` grammar ranges ([start, end]
 * UTF-16 offsets) when there are any. */
export function initMainTaps({ key, hits, onInspect }) {
  let down = null
  let timer
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const within = (event) => (event.target instanceof Element ? event.target.closest(MAIN) : null)
  const interactive = (main) => main?.dataset.inspectable === 'true'
  document.addEventListener(
    'pointerdown',
    (event) => {
      const main = within(event)
      if (!main) return
      cancel()
      down = interactive(main) && event.button === 0 && !pageSelection() ? { ...point(event), key: key() } : null
    },
    true,
  )
  document.addEventListener('pointercancel', (event) => {
    if (!within(event)) return
    down = null
    cancel()
  })
  document.addEventListener('dblclick', (event) => {
    if (within(event)) cancel()
  })
  document.addEventListener('pointerup', (event) => {
    const main = within(event)
    if (!main) return
    const start = down
    down = null
    if (!interactive(main) || !start || start.key !== key() || !isInspectTap(start, point(event), pageSelection())) return
    const text = main.textContent
    const offset = textOffsetAtPoint(main, event.clientX, event.clientY)
    if (offset === null || offset >= text.length) return
    // The full grammar ranges, not the rendered phrases: the selected mark
    // replaces the phrases inside it.
    const ranges = hits()
    const whole = main.getAttribute('role') === 'button'
    if (!whole && ranges.length && !ranges.some(([s, e]) => offset >= s && offset < e)) return
    // Let native double-click and long-press selection win before inspecting.
    timer = setTimeout(() => {
      timer = undefined
      if (!pageSelection() && interactive(main) && start.key === key()) onInspect(offset)
    }, GRACE_MS)
  })
  window.addEventListener('pagehide', () => {
    down = null
    cancel()
  })
}

/** Source grammar taps (SourceHighlight). `mirror()` returns the inert
 * mirror while learning the original source, `key()` the result state the
 * tap belongs to; `onInspect(offset)` receives the grammar span's start. */
export function initSourceTaps(ta, { mirror, key, onInspect }) {
  let down = null
  let timer
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    down = null
  }
  // The editor's own selection (the page selection excludes it in WebKit).
  const selected = () => ta.value.slice(ta.selectionStart, ta.selectionEnd)
  const hit = (x, y) => {
    const bounds = ta.getBoundingClientRect()
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null
    for (const span of mirror()?.querySelectorAll('[data-source-start]') ?? []) {
      if ([...span.getClientRects()].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return Number(span.dataset.sourceStart)
    }
    return null
  }
  ta.addEventListener('pointerdown', (event) => {
    cancel()
    if (event.button !== 0 || !event.isPrimary || selected()) return
    const offset = hit(event.clientX, event.clientY)
    if (offset !== null) down = { ...point(event), offset, pointerId: event.pointerId, value: ta.value, key: key() }
  })
  window.addEventListener('pointermove', (event) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) >= 8) cancel()
  })
  window.addEventListener('pointerup', (event) => {
    const start = down
    if (start && event.pointerId !== start.pointerId) return
    down = null
    if (!start || event.button !== 0 || !isInspectTap(start, point(event), selected())) return
    timer = setTimeout(() => {
      timer = undefined
      if (ta.isConnected && document.activeElement === ta && ta.value === start.value && !selected() && start.key === key()) onInspect(start.offset)
    }, GRACE_MS)
  })
  ta.addEventListener('select', () => {
    if (selected()) cancel()
  })
  for (const type of ['pointercancel', 'dblclick', 'keydown', 'input', 'compositionstart', 'scroll', 'blur', 'contextmenu', 'dragstart']) ta.addEventListener(type, cancel)
  window.addEventListener('pagehide', cancel)
}
