// Reply context: ContextField.tsx plus TranslatorContext's tab-scoped
// `context` (useSessionState('nt.context'), stored as JSON).
//
// Hand-written: one textarea, its toggle and sessionStorage. Handlers are
// delegated on document, keyed on data-testid. The field comes from
// template#context-field: like TS, it is in the composer only while open
// (base.css selects on its presence); the same node keeps the draft.

const KEY = 'nt.context'
const $ = (selector) => document.querySelector(selector)
const id = (event, testid) => event.target.closest?.(`[data-testid="${testid}"]`)

/** Wire the context field. `resized()` re-sizes the source editor when the
 * field opens or closes; `relabel(root)` applies the current UI strings to
 * the detached field before it is inserted. Sets app.context to the raw
 * field value. */
export function initContext(app, resized, relabel) {
  const box = $('#context-field').content.firstElementChild.cloneNode(true)
  const [field, clear] = box.querySelectorAll('[data-testid]')
  const toggle = $('[data-testid="context-toggle"]')
  const tones = [toggle.className, toggle.dataset.activeClass]

  const open = (on) => {
    if (on === box.isConnected) return
    if (on) {
      relabel(box)
      $('.composer-field').prepend(box)
    } else box.remove()
    toggle.setAttribute('aria-expanded', on)
    resized()
  }
  // A non-blank context opens the field and tints the toggle (TS's effect).
  const sync = () => {
    const blank = !field.value.trim()
    clear.hidden = !field.value
    toggle.className = tones[+!blank]
    if (!blank) open(true)
  }
  const edited = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(field.value))
    } catch {
      /* Storage may be unavailable; keep the context in the page. */
    }
    sync()
    app.settingsChanged()
  }

  app.context = () => field.value
  try {
    field.value = JSON.parse(sessionStorage.getItem(KEY)) ?? ''
  } catch {
    /* Unreadable storage: start empty. */
  }
  sync()

  document.addEventListener('click', (event) => {
    if (id(event, 'context-toggle')) open(!box.isConnected)
    else if (id(event, 'context-clear')) {
      field.value = ''
      edited()
    }
  })
  document.addEventListener('input', (event) => event.target === field && edited())
  // The keyboard leaves no room for both fields: focusing the source closes
  // the context (InputPanel's onFocus).
  document.addEventListener('focusin', (event) => {
    if (id(event, 'input-textarea') && $('[data-keyboard]')) open(false)
  })
}
