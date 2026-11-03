// Settings popover (SettingsMenu.tsx): a non-modal dialog below its trigger
// (bottom-end, offset 8, flip and shift inside panelBoundary).
//
// Hand-written: the native popover attribute already gives the toggle,
// Escape and outside-press dismissal; this adds what Floating UI did on top:
// fixed placement while open, focus moving in and back, closing when focus
// leaves for an unrelated element (closeOnFocusOut) and the trigger's
// aria-controls (useRole). prefs.js mirrors aria-expanded for every popover.

import { autoUpdate, panelBoundary, position } from './float.js'

export function initSettings() {
  const popup = document.getElementById('settings-popover')
  const trigger = document.querySelector('[data-testid="settings-button"]')
  // An empty span after the trigger owns the popup, so the accessibility
  // tree lists the dialog right after its trigger (FloatingPortal does the
  // same); fixed, it takes no room in the header.
  const owner = document.createElement('span')
  owner.setAttribute('aria-owns', popup.id)
  owner.style.position = 'fixed'
  let stop = null
  // Focus was inside when closing began; focus left (no return).
  let inside = false
  let left = false

  const place = () =>
    position(trigger, popup, { placement: 'bottom-end', offset: 8, flip: true, ...panelBoundary(trigger) })

  // Hidden until placed (Floating UI's isPositioned).
  popup.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'open') popup.style.visibility = 'hidden'
    else inside = popup.contains(document.activeElement)
  })
  // closeOnFocusOut, as FloatingPortal applies it: focus leaving the trigger
  // for anything but the popup (Shift+Tab past it, a press on another
  // control), or tabbing out of the popup (its after-guard), closes it and
  // leaves focus where it went. Focus moved out of the popup by a script
  // keeps it open (the portal's insideReactTree check).
  let tabbed = false
  popup.addEventListener('keydown', (event) => {
    tabbed = event.key === 'Tab'
  })
  const focusOut = (event) => {
    const to = event.relatedTarget
    const viaTab = tabbed
    tabbed = false
    if (!to || popup.contains(to) || trigger.contains(to) || (event.currentTarget === popup && !viaTab)) return
    queueMicrotask(() => {
      if (!popup.matches(':popover-open')) return
      left = true
      popup.hidePopover()
    })
  }
  popup.addEventListener('focusout', focusOut)
  trigger.addEventListener('focusout', focusOut)
  popup.addEventListener('toggle', (event) => {
    stop?.()
    stop = null
    if (event.newState === 'open') {
      trigger.setAttribute('aria-controls', popup.id)
      trigger.after(owner)
      stop = autoUpdate(trigger, popup, place)
      popup.style.visibility = ''
      // Floating UI focuses the dialog itself (its first button is still
      // hidden while it looks for one); Tab then reaches the buttons.
      popup.focus({ preventScroll: true })
    } else {
      trigger.removeAttribute('aria-controls')
      owner.remove()
      // Focus returns to the trigger when it was inside or fell to the
      // body (Floating UI's returnFocus), not after it left on its own.
      if (!left && (inside || document.activeElement === document.body)) trigger.focus({ preventScroll: true })
      left = false
    }
  })
}
