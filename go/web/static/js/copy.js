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

const COPIED_MS = 1200

async function copy(button, text, app) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return
  }
  const label = button.querySelector('[data-t="copy"]')
  const set = (key) => {
    button.setAttribute('aria-label', app.t(key))
    button.title = app.t(key)
    if (label) label.textContent = app.t(key)
  }
  set('copied')
  clearTimeout(button._copied)
  button._copied = setTimeout(() => set('copy'), COPIED_MS)
}

export function initCopy(app) {
  const toolbar = document.querySelector('[data-testid="output-toolbar"]')
  const mainCopy = toolbar.querySelector('[data-testid="copy-button"]')
  const mainListen = toolbar.querySelector('[data-testid="listen-button"]')
  const alternatives = () => document.querySelectorAll('#alternatives [data-testid="copy-button"]')

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
