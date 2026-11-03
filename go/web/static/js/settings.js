// Settings popover (SettingsMenu.tsx): a non-modal dialog below its trigger
// (bottom-end, offset 8, flip and shift inside panelBoundary).
//
// Hand-written: the native popover attribute already gives the toggle,
// Escape and outside-press dismissal; this adds what Floating UI did on top:
// fixed placement while open, focus moving in and back, and the trigger's
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

  const place = () =>
    position(trigger, popup, { placement: 'bottom-end', offset: 8, flip: true, ...panelBoundary(trigger) })

  // Hidden until placed (Floating UI's isPositioned).
  popup.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'open') popup.style.visibility = 'hidden'
  })
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
      // Focus returns to the trigger unless the dismissing press focused
      // something else.
      const active = document.activeElement
      if (!active || active === document.body || popup.contains(active)) trigger.focus()
    }
  })
}
