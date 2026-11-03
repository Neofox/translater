// Preferences: the nt.preferences cookie, header controls, language chip bars
// and their More listbox, the Settings popover and UI-language labels.
//
// Hand-written: the cookie format is shared with the TS app (src/lib/
// preferences.ts) and the controls are a few native buttons. Popups use the
// native `popover` attribute, placed by float.js.

import { autoUpdate, panelBoundary, position } from './float.js'
import { initSettings } from './settings.js'

/** Cookie string for `prefs`, byte-compatible with encodePreferencesCookie. */
export function encodePrefsCookie(prefs, rules, secure) {
  const values = { version: rules.version }
  for (const key of rules.fields) values[key] = prefs[key] ?? null
  return `${rules.cookie}=${encodeURIComponent(JSON.stringify(values))}; Path=/; Max-Age=${rules.maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`
}

export function writePrefsCookie(prefs, rules) {
  try {
    document.cookie = encodePrefsCookie(prefs, rules, location.protocol === 'https:')
  } catch {
    /* Cookies may be unavailable; keep preferences in memory. */
  }
}

const UI_LANGS = ['en', 'ko']
/** UiLangToggle's idle and pressed class tokens. */
const UI_LANG_TOKENS = [['text-ink-soft', 'hover:text-ink'], ['bg-accent', 'text-bg', 'shadow-sm']]
const uiLangButtons = () => [...document.querySelectorAll('[aria-label="UI language"] button')]

export const FIXED = { source: ['auto', 'en', 'ko'], target: ['en', 'ko'] }


export function initPrefs(app, data) {
  const prefsForm = document.getElementById('prefs-form')

  /** Apply UI strings to every [data-t] / [data-t-attr] element of root
   * (the document, or a detached node about to be inserted). */
  function applyStrings(root = document) {
    if (root === document) document.documentElement.lang = app.prefs.uiLang
    for (const el of root.querySelectorAll('[data-t]')) el.textContent = app.t(el.dataset.t)
    for (const el of root.querySelectorAll('[data-t-attr]'))
      for (const pair of el.dataset.tAttr.split(' ')) {
        const [attr, key] = pair.split(':')
        el.setAttribute(attr, app.t(key))
      }
  }

  /** A Tone button's mode: the narrow-screen select's option at the same
   * index (ModeToggle.tsx renders no value attribute on the buttons). */
  const modeOf = (button) =>
    document.querySelectorAll('.mode-select option')[[...button.parentElement.children].indexOf(button)]?.value

  /** Pressed states that must not wait for the /prefs round trip. */
  function syncControls() {
    const p = app.prefs
    for (const b of document.querySelectorAll('.mode-segment button'))
      b.setAttribute('aria-pressed', String(modeOf(b) === p.mode))
    const select = document.querySelector('.mode-select')
    if (select) select.value = p.mode
    // UiLangToggle's state tokens end its class string (settings.templ).
    for (const [i, b] of uiLangButtons().entries()) {
      const on = UI_LANGS[i] === p.uiLang
      b.setAttribute('aria-pressed', String(on))
      b.classList.remove(...UI_LANG_TOKENS[+!on])
      b.classList.add(...UI_LANG_TOKENS[+on])
    }
    for (const bar of ['source', 'target'])
      for (const chip of document.querySelectorAll(`#${bar}-bar [data-testid="lang-chip"]`)) {
        chip.setAttribute('aria-pressed', String(chip.dataset.value === p[bar]))
      }
    syncDetected()
  }

  /** Auto chip shows the detected language while selected (Auto·KO). */
  function syncDetected() {
    const chip = document.querySelector('#source-bar [data-testid="lang-chip"][data-value="auto"]')
    if (!chip) return
    const detected = app.prefs.source === 'auto' ? app.detected() : null
    const label = (code) => data.languages.find((l) => l.code === code)?.label ?? code
    chip.setAttribute('aria-label', detected ? `${label('auto')} · ${label(detected)}` : label('auto'))
    const [sr, visible] = chip.children
    if (sr) sr.textContent = detected ? `${label('auto')} · ${label(detected)}` : label('auto')
    if (visible) visible.textContent = detected ? `Auto·${detected.toUpperCase()}` : 'Auto'
  }

  /** Re-render the chip bars from the server for the saved preferences. */
  function postPrefs() {
    for (const key of data.rules.fields) prefsForm.elements[key].value = app.prefs[key] ?? ''
    htmx.trigger(prefsForm, 'nt-prefs')
  }
  // A /prefs morph re-renders the bars, including an open More listbox's
  // (always empty) markup: refill it so an open menu keeps its options.
  document.addEventListener('htmx:after:swap', () => {
    syncControls()
    for (const menu of document.querySelectorAll('[role="listbox"][popover]'))
      if (isOpen(menu) && !menu.firstElementChild) {
        document.querySelector(`[popovertarget="${menu.id}"]`)?.setAttribute('aria-expanded', 'true')
        fillMenu(menu)
        focusOption(menu)
      }
  })

  /** Change one preference: cookie first (an immediate reload keeps it).
   * `quiet` skips the re-run when the caller already reschedules (the
   * auto-target flip inside an input change keeps a paste immediate). */
  function set(key, value, { quiet = false } = {}) {
    if (app.prefs[key] === value) return
    app.prefs[key] = value
    if (key === 'source' || key === 'target') {
      const recent = key === 'source' ? 'recentSource' : 'recentTarget'
      if (!FIXED[key].includes(value)) app.prefs[recent] = value
    }
    writePrefsCookie(app.prefs, data.rules)
    if (key === 'uiLang') applyStrings()
    syncControls()
    postPrefs()
    if (!quiet) app.settingsChanged()
  }

  document.addEventListener('click', (event) => {
    const el = event.target instanceof Element ? event.target : null
    const mode = el?.closest('.mode-segment button')
    if (mode) return set('mode', modeOf(mode))
    const ui = el?.closest('[aria-label="UI language"] button')
    if (ui) return set('uiLang', UI_LANGS[uiLangButtons().indexOf(ui)])
    const chip = el?.closest('[data-testid="lang-chip"]')
    if (chip) return set(chip.closest('[data-kind]').dataset.kind, chip.dataset.value)
    const option = el?.closest('[data-testid="select-option"]')
    if (option) {
      const menu = option.closest('[popover]')
      menu.hidePopover()
      return set(menu.dataset.kind, option.dataset.value)
    }
  })
  document.querySelector('.mode-select')?.addEventListener('change', (event) => set('mode', event.target.value))

  const isOpen = (el) => {
    try {
      return el.matches(':popover-open')
    } catch {
      return false
    }
  }
  const focusOption = (menu) =>
    (menu.querySelector('[aria-selected="true"]') ?? menu.querySelector('button'))?.focus()

  /** The options a bar's More listbox offers: every language not shown as a
   * visible chip (Select.tsx options). */
  function fillMenu(menu) {
    const kind = menu.dataset.kind
    const bar = document.getElementById(`${kind}-bar`)
    const value = app.prefs[kind]
    const visible = [...bar.querySelectorAll('[data-testid="lang-chip"]')]
      .filter((chip) => chip.offsetParent !== null)
      .map((chip) => chip.dataset.value)
    const template = document.getElementById('lang-option')
    const items = []
    for (const lang of data.languages) {
      if ((kind === 'target' && lang.code === 'auto') || visible.includes(lang.code)) continue
      const item = template.content.firstElementChild.cloneNode(true)
      const button = item.querySelector('button')
      const selected = lang.code === value
      button.dataset.value = lang.code
      button.setAttribute('aria-selected', String(selected))
      button.classList.toggle('text-accent', selected)
      button.classList.toggle('text-ink', !selected)
      button.querySelector('span').textContent = lang.label
      button.querySelector('svg').toggleAttribute('hidden', !selected)
      items.push(item)
    }
    menu.replaceChildren(...items)
  }

  // Popover triggers mirror their state in aria-expanded (Floating UI's
  // useRole does this for Settings and the listboxes). More… listbox options
  // exist only while open (one listbox in the DOM).
  document.addEventListener('beforetoggle', (event) => {
    const menu = event.target
    if (!(menu instanceof HTMLElement) || !menu.hasAttribute('popover')) return
    const trigger = document.querySelector(`[popovertarget="${menu.id}"]`)
    const open = event.newState === 'open'
    trigger?.setAttribute('aria-expanded', String(open))
    if (menu.getAttribute('role') !== 'listbox') return
    if (open) {
      // Hidden until placed (Floating UI's isPositioned); toggle shows it.
      menu.style.visibility = 'hidden'
      fillMenu(menu)
    } else menu.replaceChildren()
  }, true)
  // Select.tsx's placement: bottom-start, offset 6, flip and shift inside
  // panelBoundary, at most 320 px high and at least as wide as the trigger.
  let unfollow = null
  document.addEventListener('toggle', (event) => {
    const popup = event.target
    if (!(popup instanceof HTMLElement) || popup.getAttribute('role') !== 'listbox') return
    unfollow?.()
    unfollow = null
    const trigger = document.querySelector(`[popovertarget="${popup.id}"]`)
    if (event.newState !== 'open' || !trigger) return
    popup.style.minWidth = `${trigger.offsetWidth}px`
    unfollow = autoUpdate(trigger, popup, () =>
      position(trigger, popup, { placement: 'bottom-start', offset: 6, flip: true, maxHeight: 320, ...panelBoundary(trigger) }))
    popup.style.visibility = ''
    focusOption(popup)
  }, true)
  // Arrow keys move between options; typing focuses the next option whose
  // label starts with the typed text (useTypeahead, reset after 750 ms).
  let typed = ''
  let typedAt = 0
  document.addEventListener('keydown', (event) => {
    const option = event.target instanceof Element && event.target.closest('[data-testid="select-option"]')
    if (!option) return
    const options = [...option.closest('[role="listbox"]').querySelectorAll('button')]
    const n = options.length
    let i = options.indexOf(option)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') i += event.key === 'ArrowDown' ? 1 : -1
    else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      typed = (event.timeStamp - typedAt > 750 ? '' : typed) + event.key.toLowerCase()
      typedAt = event.timeStamp
      // A new search starts after the focused option; a longer one may stay.
      const from = typed.length > 1 ? i : i + 1
      const k = options.findIndex((_, k) =>
        options[(from + k) % n].textContent.trim().toLowerCase().startsWith(typed))
      if (k < 0) return
      i = from + k
    } else return
    event.preventDefault()
    options[(i + n) % n].focus()
  })

  initSettings()
  syncControls()
  return { set, syncDetected, applyStrings }
}
