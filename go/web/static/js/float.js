// Fixed-position popups: the Floating UI subset the TS app uses (placement
// bottom-start/end, offset, flip, shift, size, autoUpdate) plus
// floatingPanelBoundary.ts and AdjustMenu's primary-actions clearance.
//
// Hand-written: the spec rules out Floating UI, and CSS anchor positioning
// cannot express the pane-bounded shift or the clearance rule.

const sides = (p) => (typeof p === 'number' ? { top: p, right: p, bottom: p, left: p } : p)

/** Coordinates for a floating box of `floating` size next to the
 * `reference` rect, kept inside `clip` (a rect) minus `padding`. Rects have
 * left/top/right/bottom. Returns {x, y, placement, availableHeight}. */
export function compute({ reference, floating, clip, placement, offset = 0, padding = 0, flip, clearance, dpr = 1 }) {
  const pad = sides(padding)
  const { width: w, height: h } = floating
  const top = clip.top + pad.top
  const bottom = clip.bottom - pad.bottom
  const below = reference.bottom + offset
  const above = reference.top - offset - h
  // Flip (Floating UI's bestFit): the other side when it overflows less.
  const overflow = (upward) => (upward ? top - above : below + h - bottom)
  let up = placement.startsWith('top')
  if (flip && overflow(up) > 0 && overflow(!up) < overflow(up)) up = !up
  let x = placement.endsWith('end') ? reference.right - w : reference.left
  const y = up ? above : below
  // Shift: Floating UI clamps the start edge last, so it wins when too wide.
  x = Math.max(clip.left + pad.left, Math.min(x, clip.right - pad.right - w))
  if (clearance && y < clearance.bottom && y + h > clearance.top)
    x = Math.max(16, Math.min(x, clearance.left - w - 12))
  const round = (v) => Math.round(v * dpr) / dpr
  return {
    x: round(x),
    y: round(y),
    placement: placement.replace(/^\w+/, up ? 'top' : 'bottom'),
    availableHeight: Math.min(up ? reference.top - offset - top : bottom - below, bottom - top),
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
 * box at the available height (Floating UI's size middleware). */
export function position(reference, floating, { boundary, clearance, maxHeight, ...options }) {
  let clip = viewportRect()
  if (boundary) {
    const b = boundary.getBoundingClientRect()
    clip = {
      left: Math.max(clip.left, b.left),
      top: Math.max(clip.top, b.top),
      right: Math.min(clip.right, b.right),
      bottom: Math.min(clip.bottom, b.bottom),
    }
  }
  const style = floating.style
  style.position = 'fixed'
  const run = (overrides) =>
    compute({
      reference: reference.getBoundingClientRect(),
      floating: { width: floating.offsetWidth, height: floating.offsetHeight },
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
  style.left = `${result.x}px`
  style.top = `${result.y}px`
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
