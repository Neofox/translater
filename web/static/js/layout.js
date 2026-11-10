// Workspace layout: the pane arrangement, keyboard state and viewport sizes.
//
// Hand-written: the mode/keyboard rules are app policy, measured from the
// visual viewport. The server paints COMPACT_LAYOUT with data-layout-pending
// (CSS container queries choose the startup arrangement); the first measure
// writes the real attributes and drops the pending flag in the same task.
// A layout change moves only .output-panel, so the input panel and its
// textarea (focus, caret, IME composition) are never moved.

export const COMPACT_LAYOUT = {
  mode: 'stack', resultFirst: true, desktop: false, short: false, tight: false, keyboard: false,
}
const KEYS = Object.keys(COMPACT_LAYOUT)

export const initialLayoutState = (innerWidth, innerHeight) => ({
  natural: { width: innerWidth, height: innerHeight },
  layout: COMPACT_LAYOUT,
})

/**
 * One measurement. `width` is the panels' outer width (0: the window's),
 * `visible`/`offsetTop`/`scale` come from visualViewport, `layoutHeight`
 * is the layout viewport (documentElement.clientHeight), `posture` is
 * 'book', 'laptop' or null. `state` is the previous { natural, layout }:
 * the keyboard flag latches, and the natural (pre-keyboard) height is kept
 * while editing. Returns the next { layout, natural, appHeight, appTop };
 * an unchanged layout keeps its identity.
 */
export function decideLayout(input, state) {
  const { innerWidth, sideInsets = 0, editing = false, touch = false, posture = null } = input
  const zoomed = Math.abs((input.scale || 1) - 1) > 0.01
  // iOS Safari shrinks innerHeight with the pinch scale (it is the visual
  // viewport there); the layout viewport keeps the unzoomed height, so a
  // zoomed page must not collapse the shell to the zoomed-in height.
  const innerHeight = zoomed && input.layoutHeight ? input.layoutHeight : input.innerHeight
  const visible = zoomed ? innerHeight : input.visible || innerHeight
  const outerWidth = input.width || innerWidth
  let natural = state.natural
  if (Math.abs(outerWidth - natural.width) > 1)
    natural = { width: outerWidth, height: Math.max(innerHeight, visible) }
  const keyboard =
    !zoomed &&
    (state.layout.keyboard || (editing && (touch || visible < innerHeight - 100))) &&
    natural.height - visible > Math.max(100, natural.height * 0.2)
  // Keyboard animations arrive as many small resizes: keep the original
  // height throughout editing instead of ratcheting it down each frame.
  const screenResize = !touch && visible >= innerHeight
  if (!keyboard && !zoomed && (!editing || screenResize)) natural = { ...natural, height: visible }
  // Safari may pan its visual viewport independently of the layout
  // viewport; clamp a stale offset back to zero once the keyboard is gone.
  const appTop = zoomed
    ? 0
    : Math.max(0, Math.min(input.offsetTop || 0, Math.max(innerHeight, natural.height) - visible))
  const width = Math.max(0, outerWidth - sideInsets)
  const mode = posture
    ? posture
    : width >= 1100
      ? 'workspace'
      : width >= 560 && width > natural.height
        ? 'split'
        : 'stack'
  const next = {
    mode,
    resultFirst: mode === 'laptop' || mode === 'stack',
    desktop: mode === 'workspace',
    short: visible < 460,
    tight: visible < 360,
    keyboard,
  }
  const same = KEYS.every((key) => next[key] === state.layout[key])
  return { layout: same ? state.layout : next, natural, appHeight: visible, appTop }
}

/**
 * In laptop posture the first panel ends at the physical fold: write the
 * panels' document top (below the measured header, never an assumed size)
 * as --panels-top while `laptop` matches.
 */
export function initFold(panels, laptop) {
  let observer
  const measure = () =>
    panels.style.setProperty('--panels-top', `${panels.getBoundingClientRect().top + window.scrollY}px`)
  const sync = () => {
    observer?.disconnect()
    window.removeEventListener('resize', measure)
    if (!laptop.matches) {
      panels.style.removeProperty('--panels-top')
      return
    }
    measure()
    observer = new ResizeObserver(measure)
    observer.observe(panels)
    const header = panels.closest('.app-shell')?.querySelector('header')
    if (header) observer.observe(header)
    window.addEventListener('resize', measure)
  }
  sync()
  laptop.addEventListener('change', sync)
}

const flag = (el, name, on) => (on ? el.setAttribute(name, 'true') : el.removeAttribute(name))

/**
 * Measure `panels` (.translator-panels) now and on every viewport change.
 * Dispatches `nt-layout` (detail: the layout) on document after the first
 * measure and after every change. Returns { layout() }.
 */
export function initLayout(panels) {
  const shell = panels.closest('.app-shell')
  const media = (query) => window.matchMedia(query)
  const book = media('(device-posture: folded) and (horizontal-viewport-segments: 2)')
  const laptop = media('(device-posture: folded) and (vertical-viewport-segments: 2)')
  const touch = media('(any-pointer: coarse)')
  const viewport = window.visualViewport
  let state = initialLayoutState(window.innerWidth, window.innerHeight)
  let pending = true
  let measuring = false

  function apply(layout, previous) {
    for (const el of [shell, panels]) {
      el.dataset.layout = layout.mode
      flag(el, 'data-desktop', layout.desktop)
      flag(el, 'data-short', layout.short)
      flag(el, 'data-tight', layout.tight)
      flag(el, 'data-keyboard', layout.keyboard)
    }
    flag(panels, 'data-result-first', layout.resultFirst)
    const output = panels.querySelector(':scope > .output-panel')
    if (output && layout.resultFirst !== previous.resultFirst) {
      if (layout.resultFirst) panels.prepend(output)
      else panels.append(output)
    }
    if (layout.keyboard && !previous.keyboard) {
      const result = panels.querySelector('.result-scroll')
      if (result) result.scrollTop = 0
    }
  }

  function measure() {
    // Moving a focused output control fires focusout inside measure().
    if (measuring) return
    measuring = true
    try {
      // Inputs are read before any write; the panels' height is read after
      // --app-height is written (it depends on it).
      const focused = document.activeElement
      const editing =
        focused instanceof HTMLElement &&
        shell.contains(focused) &&
        focused.matches('textarea, input, [contenteditable="true"]')
      const style = getComputedStyle(shell)
      const sideInsets =
        (parseFloat(style.getPropertyValue('--safe-area-left')) || 0) +
        (parseFloat(style.getPropertyValue('--safe-area-right')) || 0)
      const result = decideLayout(
        {
          width: panels.clientWidth,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          layoutHeight: document.documentElement.clientHeight,
          visible: viewport?.height,
          offsetTop: viewport?.offsetTop,
          scale: viewport?.scale,
          sideInsets,
          editing,
          touch: touch.matches,
          posture: laptop.matches ? 'laptop' : book.matches ? 'book' : null,
        },
        state,
      )
      // The panels' height follows --app-height, so read it only after
      // writing the new value.
      shell.style.setProperty('--app-height', `${result.appHeight}px`)
      shell.style.setProperty('--app-top', `${result.appTop}px`)
      panels.style.setProperty('--workspace-height', `${panels.clientHeight || result.appHeight}px`)
      const previous = state.layout
      state = { natural: result.natural, layout: result.layout }
      if (result.layout === previous && !pending) return
      apply(result.layout, pending ? COMPACT_LAYOUT : previous)
      if (pending) {
        pending = false
        panels.removeAttribute('data-layout-pending')
      }
      // A moved output control loses focus; give it back.
      if (focused instanceof HTMLElement && panels.contains(focused) && document.activeElement === document.body)
        focused.focus({ preventScroll: true })
      document.dispatchEvent(new CustomEvent('nt-layout', { detail: result.layout }))
    } finally {
      measuring = false
    }
  }

  let frame = 0
  if (typeof ResizeObserver !== 'undefined')
    new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }).observe(panels)
  window.addEventListener('resize', measure)
  viewport?.addEventListener('resize', measure)
  viewport?.addEventListener('scroll', measure)
  panels.addEventListener('focusin', measure)
  panels.addEventListener('focusout', measure)
  book.addEventListener('change', measure)
  laptop.addEventListener('change', measure)
  // Returning to the tab (or a bfcache restore) may not fire a resize, and
  // Safari settles its viewport only after the first frame: measure on
  // both sides of it.
  const resume = () => {
    if (document.hidden) return
    measure()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
  }
  window.addEventListener('pageshow', resume)
  document.addEventListener('visibilitychange', resume)
  measure()
  initFold(panels, laptop)
  return { layout: () => state.layout }
}
