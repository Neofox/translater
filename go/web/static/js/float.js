// Fixed-position popups: the Floating UI subset the TS app uses (placement
// bottom-start/end, offset, flip, shift, size, autoUpdate) plus
// floatingPanelBoundary.ts and AdjustMenu's primary-actions clearance.
//
// Hand-written: the spec rules out Floating UI, and CSS anchor positioning
// cannot express the pane-bounded shift or the clearance rule.

const sides = (p) => (typeof p === 'number' ? { top: p, right: p, bottom: p, left: p } : p)
const OPPOSITE = { top: 'bottom', bottom: 'top', start: 'end', end: 'start', left: 'right', right: 'left' }
const otherSide = (p) => p.replace(/^\w+/, (s) => OPPOSITE[s])
const otherAlignment = (p) => p.replace(/\w+$/, (a) => OPPOSITE[a])

/** Coordinates for a floating box of `floating` size (top|bottom-start|end
 * of the `reference` rect), kept inside `clip` (a rect) minus `padding`.
 * Rects have left/top/right/bottom (and width for the reference). Returns
 * {x, y, placement, availableHeight}. */
export function compute({ reference, floating, clip, placement, offset = 0, padding = 0, flip, clearance, dpr = 1 }) {
  const pad = sides(padding)
  const { width: w, height: h } = floating
  const room = { top: clip.top + pad.top, bottom: clip.bottom - pad.bottom, left: clip.left + pad.left, right: clip.right - pad.right }
  const at = (p) => ({
    x: p.endsWith('end') ? reference.right - w : reference.left,
    y: p.startsWith('top') ? reference.top - offset - h : reference.bottom + offset,
  })
  // detectOverflow on the placement's side, then its two alignment sides
  // (getAlignmentSides: a start-aligned box overflows right first, unless
  // the reference is the wider one).
  const overflows = (p) => {
    const { x, y } = at(p)
    const o = { top: room.top - y, bottom: y + h - room.bottom, left: room.left - x, right: x + w - room.right }
    let align = p.endsWith('start') ? 'right' : 'left'
    if (reference.width > w) align = OPPOSITE[align]
    return [o[p.split('-')[0]], o[align], o[OPPOSITE[align]]]
  }
  // flip(): the first placement that fits, trying the other alignment, the
  // other side and both; else the one fitting its side with the least
  // alignment overflow; else the least total overflow (bestFit).
  let chosen = placement
  if (flip) {
    const tried = []
    chosen = undefined
    for (const p of [placement, otherAlignment(placement), otherSide(placement), otherAlignment(otherSide(placement))]) {
      const o = overflows(p)
      tried.push([p, o])
      if (o.every((v) => v <= 0)) {
        chosen = p
        break
      }
    }
    const total = (o) => o.reduce((sum, v) => sum + Math.max(v, 0), 0)
    chosen ??=
      tried.filter(([, o]) => o[0] <= 0).sort((a, b) => a[1][1] - b[1][1])[0]?.[0] ??
      tried.sort((a, b) => total(a[1]) - total(b[1]))[0][0]
  }
  let { x, y } = at(chosen)
  // shift() on the main axis: the start edge is clamped last, so it wins
  // when the box is too wide.
  x = Math.max(room.left, Math.min(x, room.right - w))
  if (clearance && y < clearance.bottom && y + h > clearance.top)
    x = Math.max(16, Math.min(x, clearance.left - w - 12))
  const round = (v) => Math.round(v * dpr) / dpr
  const up = chosen.startsWith('top')
  return {
    x: round(x),
    y: round(y),
    placement: chosen,
    availableHeight: Math.min(up ? reference.top - offset - room.top : room.bottom - reference.bottom - offset, room.bottom - room.top),
  }
}

/** The visual viewport as a rect (Floating UI's fixed-strategy viewport). */
function viewportRect() {
  const vv = window.visualViewport
  const left = vv?.offsetLeft ?? 0
  const top = vv?.offsetTop ?? 0
  const width = vv?.width ?? document.documentElement.clientWidth
  const height = vv?.height ?? document.documentElement.clientHeight
  return { left, top, right: left + width, bottom: top + height }
}

/** Place `floating` (fixed) next to `reference` and return compute()'s
 * result. `boundary` (an element) narrows the viewport; `clearance` is an
 * element the box must not overlap (AdjustMenu); `maxHeight` caps the
 * box at the available height (Floating UI's size middleware).
 * `translate` writes useFloating's floatingStyles (left/top 0 and a
 * translate) instead of left/top. */
export function position(reference, floating, { boundary, clearance, maxHeight, translate, ...options }) {
  let clip = viewportRect()
  if (boundary) {
    // Its padding box (getClippingElementRect): inside borders and scrollbars.
    const b = boundary.getBoundingClientRect()
    const left = b.left + boundary.clientLeft
    const top = b.top + boundary.clientTop
    clip = {
      left: Math.max(clip.left, left),
      top: Math.max(clip.top, top),
      right: Math.min(clip.right, left + boundary.clientWidth),
      bottom: Math.min(clip.bottom, top + boundary.clientHeight),
    }
  }
  const style = floating.style
  style.position = 'fixed'
  const run = (overrides) =>
    compute({
      reference: reference.getBoundingClientRect(),
      floating: floating.getBoundingClientRect(),
      clip,
      clearance: clearance?.getBoundingClientRect(),
      dpr: window.devicePixelRatio || 1,
      ...options,
      ...overrides,
    })
  let result = run()
  if (maxHeight) {
    style.maxHeight = `${Math.max(0, Math.min(result.availableHeight, maxHeight))}px`
    // The new height moves a box placed above; keep the chosen side.
    result = run({ placement: result.placement, flip: false })
  }
  if (translate) {
    style.left = style.top = '0px'
    style.transform = `translate(${result.x}px, ${result.y}px)`
    if (window.devicePixelRatio >= 1.5) style.willChange = 'transform'
  } else {
    style.left = `${result.x}px`
    style.top = `${result.y}px`
  }
  return result
}

/** Re-run `update` while either element resizes or anything scrolls or
 * resizes. Returns the cleanup. */
export function autoUpdate(reference, floating, update) {
  const observer = new ResizeObserver(() => update())
  observer.observe(reference)
  observer.observe(floating)
  const targets = [window, window.visualViewport].filter(Boolean)
  for (const t of targets) {
    t.addEventListener('scroll', update, { capture: true, passive: true })
    t.addEventListener('resize', update)
  }
  update()
  return () => {
    observer.disconnect()
    for (const t of targets) {
      t.removeEventListener('scroll', update, { capture: true })
      t.removeEventListener('resize', update)
    }
  }
}

/** floatingPanelBoundary.ts: only segmented layouts keep a popup inside its
 * pane; elsewhere (a short composer) a menu may extend over the result.
 * Padding is 8 px plus the safe-area inset on each side. */
export function panelBoundary(reference) {
  const panel = reference.closest('section')
  const layout = reference.closest('.translator-panels')?.dataset.layout
  const style = getComputedStyle(panel ?? reference)
  const inset = (side) => 8 + (parseFloat(style.getPropertyValue(`--safe-area-${side}`)) || 0)
  return {
    padding: { top: inset('top'), right: inset('right'), bottom: inset('bottom'), left: inset('left') },
    boundary: ['book', 'laptop', 'split', 'workspace'].includes(layout) ? (panel ?? undefined) : undefined,
  }
}

/** Popups closeOnFocusOut hid: their close must not return focus. */
export const leftFocus = new WeakSet()

/** Floating UI's closeOnFocusOut (non-modal FloatingFocusManager in a
 * FloatingPortal) for every native popover and its popovertarget trigger,
 * delegated on document: focus leaving the trigger for anything but its
 * popup (Shift+Tab past it, focusing another control), or Tab leaving the
 * popup, hides it and leaves focus where it went. Focus moved out of the
 * popup any other way (a script) keeps it open, as the portal's
 * insideReactTree check does. */
export function closeOnFocusOut() {
  let tabbed = false
  document.addEventListener('keydown', (event) => (tabbed = event.key === 'Tab'), true)
  document.addEventListener('focusout', (event) => {
    const viaTab = tabbed
    tabbed = false
    const from = event.target
    if (!(from instanceof Element)) return
    const id = from.getAttribute('popovertarget')
    const popup = id ? document.getElementById(id) : from.closest('[popover]')
    const to = event.relatedTarget
    if (!popup || !to || popup.contains(to) || (!id && !viaTab)) return
    if (document.querySelector(`[popovertarget="${popup.id}"]`)?.contains(to)) return
    queueMicrotask(() => {
      if (!popup.matches(':popover-open')) return
      leftFocus.add(popup)
      popup.hidePopover()
    })
  })
}
