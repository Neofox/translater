// Copy and Listen enabling plus the Copy actions.
//
// Hand-written: which result may be copied is app policy (ports of
// src/lib/translationRequestKey.ts and src/lib/liveResult.ts); the clipboard
// is the platform API.

/** Page-memory identity of the request settings that produced a result. */
export function requestKey({ text, source, target, mode, context, refinements, uiLang }) {
  return JSON.stringify([text.trim(), source, target, mode, context, refinements, uiLang])
}

/** Main Copy text, or null while the result is not current and ready. */
export function copyableMain(live, currentKey) {
  if (!live || live.error) return null
  if (!(live.mainReady || live.done) || live.key !== currentKey) return null
  return (live.main ?? '').trim() || null
}

/** How long a Copy button confirms a copy. */
export const COPIED_MS = 1500

/** A Copy button's Copied state, on or off: its name, title and visible
 * label, and `data-copied` with the check icon in place of the copy icon
 * (base.css tints it violet). `t` looks up UI strings. */
export function showCopied(button, on, t) {
  const key = on ? 'copied' : 'copy'
  button.setAttribute('aria-label', t(key))
  button.setAttribute('title', t(key))
  const label = button.querySelector('[data-t="copy"]')
  if (label) label.textContent = t(key)
  button.toggleAttribute('data-copied', on)
  button.querySelector('.lucide-copy')?.toggleAttribute('hidden', on)
  button.querySelector('.lucide-check')?.toggleAttribute('hidden', !on)
}

/** Confirm a copy on `button` for COPIED_MS; another copy restarts it. */
export function flashCopied(button, t) {
  showCopied(button, true, t)
  clearTimeout(button._copied)
  button._copied = setTimeout(() => showCopied(button, false, t), COPIED_MS)
}

/** A polite live region that says "Copied": screen readers do not
 * reliably announce a focused button's new name (VoiceOver on iOS does
 * not). Created on the first copy; its text is set a moment later so the
 * new region is in the accessibility tree first. */
let region = null
let announced = 0
function announce(text) {
  if (!region) {
    region = document.createElement('div')
    region.className = 'sr-only'
    region.setAttribute('role', 'status')
    region.dataset.testid = 'copy-status'
    document.body.append(region)
  }
  region.textContent = ''
  clearTimeout(announced)
  announced = setTimeout(() => {
    region.textContent = text
    announced = setTimeout(() => (region.textContent = ''), COPIED_MS)
  }, 100)
}

async function copy(button, text, app) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return
  }
  flashCopied(button, app.t)
  announce(app.t('copied'))
}

export function initCopy(app) {
  // iOS Safari applies :active (the pressed Copy state in base.css) to a
  // touch only when the page listens for touchstart.
  document.addEventListener('touchstart', () => {}, { passive: true })
  const toolbar = document.querySelector('[data-testid="output-toolbar"]')
  const mainCopy = toolbar.querySelector('[data-testid="copy-button"]')
  const mainListen = toolbar.querySelector('[data-testid="listen-button"]')
  const alternatives = () =>
    document.querySelectorAll('#alternatives [data-testid="copy-button"], #alternatives [data-testid="listen-button"]')

  /** Enable controls only for the complete, current, error-free result. */
  function updateActions() {
    const live = app.live
    const key = app.currentKey()
    const text = copyableMain(live, key)
    mainCopy.disabled = !text
    const whole = Boolean(live?.done && !live.error && live.key === key && !app.pending)
    mainListen.disabled = !(whole && text)
    for (const button of alternatives()) button.disabled = !whole
  }

  function copyMain() {
    const text = copyableMain(app.live, app.currentKey())
    if (text) void copy(mainCopy, text, app)
  }

  mainCopy.addEventListener('click', copyMain)
  document.getElementById('result-details').addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('[data-testid="copy-button"]')
    if (!button || button.disabled) return
    const text = button.closest('[data-testid="alternative-item"]')?.querySelector('.alternative-text')?.textContent
    if (text) void copy(button, text, app)
  })

  return { updateActions, copyMain }
}
