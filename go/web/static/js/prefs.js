// Preferences: the nt.preferences cookie, header controls, language chip bars
// and their More listbox, the Settings popover and UI-language labels.
//
// Hand-written: the cookie format is shared with the TS app (src/lib/
// preferences.ts) and the controls are a few native buttons. Popups use the
// native `popover` attribute; placement is a few lines of fixed positioning
// (floating-ui would cost more than the whole module).

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

export const FIXED = { source: ['auto', 'en', 'ko'], target: ['en', 'ko'] }

// Pill tones (src/components/ui/Pill.tsx) of a selected and an idle chip.
const ACTIVE = ['border-accent/70', 'bg-accent-soft', '[&>svg]:text-accent']
const NEUTRAL = ['border-border', 'bg-panel', 'hover:border-accent/60']
// UiLangToggle.tsx button states.
const UI_ACTIVE = ['bg-accent', 'text-bg', 'shadow-sm']
const UI_IDLE = ['text-ink-soft', 'hover:text-ink']

/** Place a top-layer popup below `anchor`, flipping above when needed. */
export function place(popup, anchor, { align = 'start', offset = 6, maxHeight = Infinity } = {}) {
  const r = anchor.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  const vh = window.visualViewport?.height ?? window.innerHeight
  const pad = 8
  popup.style.position = 'fixed'
  popup.style.margin = '0'
  popup.style.inset = 'auto'
  popup.style.minWidth = `${r.width}px`
  const below = vh - r.bottom - offset - pad
  const above = r.top - offset - pad
  const up = below < Math.min(popup.scrollHeight, 200) && above > below
  const room = Math.max(0, Math.min(up ? above : below, maxHeight))
  popup.style.maxHeight = Number.isFinite(room) ? `${room}px` : ''
  const w = popup.offsetWidth
  const left = align === 'end' ? r.right - w : r.left
  popup.style.left = `${Math.max(pad, Math.min(left, vw - w - pad))}px`
  popup.style.top = up ? `${Math.max(pad, r.top - offset - popup.offsetHeight)}px` : `${r.bottom + offset}px`
}

export function initPrefs(app, data) {
  const prefsForm = document.getElementById('prefs-form')

  /** Apply UI strings to every [data-t] / [data-t-attr] element. */
  function applyStrings() {
    document.documentElement.lang = app.prefs.uiLang
    for (const el of document.querySelectorAll('[data-t]')) el.textContent = app.t(el.dataset.t)
    for (const el of document.querySelectorAll('[data-t-attr]'))
      for (const pair of el.dataset.tAttr.split(' ')) {
        const [attr, key] = pair.split(':')
        el.setAttribute(attr, app.t(key))
      }
  }

  /** Pressed states that must not wait for the /prefs round trip. */
  function syncControls() {
    const p = app.prefs
    for (const b of document.querySelectorAll('.mode-segment button'))
      b.setAttribute('aria-pressed', String(b.dataset.value === p.mode))
    const select = document.querySelector('.mode-select')
    if (select) select.value = p.mode
    for (const b of document.querySelectorAll('[data-ui-lang]')) {
      const pressed = b.dataset.uiLang === p.uiLang
      b.setAttribute('aria-pressed', String(pressed))
      for (const c of UI_ACTIVE) b.classList.toggle(c, pressed)
      for (const c of UI_IDLE) b.classList.toggle(c, !pressed)
    }
    for (const bar of ['source', 'target'])
      for (const chip of document.querySelectorAll(`#${bar}-bar [data-testid="lang-chip"]`)) {
        const pressed = chip.dataset.value === p[bar]
        chip.setAttribute('aria-pressed', String(pressed))
        for (const c of ACTIVE) chip.classList.toggle(c, pressed)
        for (const c of NEUTRAL) chip.classList.toggle(c, !pressed)
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
  document.addEventListener('htmx:after:swap', syncControls)

  /** Change one preference: cookie first (an immediate reload keeps it). */
  function set(key, value) {
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
    app.settingsChanged()
  }

  document.addEventListener('click', (event) => {
    const el = event.target instanceof Element ? event.target : null
    const mode = el?.closest('.mode-segment button')
    if (mode) return set('mode', mode.dataset.value)
    const ui = el?.closest('[data-ui-lang]')
    if (ui) return set('uiLang', ui.dataset.uiLang)
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

  // More… listbox: options exist only while open (one listbox in the DOM).
  document.addEventListener('beforetoggle', (event) => {
    const menu = event.target
    if (!(menu instanceof HTMLElement) || menu.getAttribute('role') !== 'listbox') return
    const trigger = document.querySelector(`[popovertarget="${menu.id}"]`)
    if (event.newState !== 'open') {
      trigger?.setAttribute('aria-expanded', 'false')
      menu.replaceChildren()
      return
    }
    const kind = menu.dataset.kind
    const bar = document.getElementById(`${kind}-bar`)
    const value = app.prefs[kind]
    const visible = [...bar.querySelectorAll('[data-testid="lang-chip"]')]
      .filter((chip) => chip.offsetParent !== null)
      .map((chip) => chip.dataset.value)
    const template = document.getElementById('lang-option')
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
      menu.append(item)
    }
    trigger?.setAttribute('aria-expanded', 'true')
  }, true)
  document.addEventListener('toggle', (event) => {
    const popup = event.target
    if (!(popup instanceof HTMLElement) || event.newState !== 'open') return
    const trigger = document.querySelector(`[popovertarget="${popup.id}"]`)
    if (!trigger) return
    const listbox = popup.getAttribute('role') === 'listbox'
    place(popup, trigger, listbox ? { maxHeight: 320 } : { align: 'end', offset: 8 })
    if (listbox) (popup.querySelector('[aria-selected="true"]') ?? popup.querySelector('button'))?.focus()
  }, true)
  // Arrow keys move between options.
  document.addEventListener('keydown', (event) => {
    const option = event.target instanceof Element && event.target.closest('[data-testid="select-option"]')
    if (!option || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    event.preventDefault()
    const options = [...option.closest('[role="listbox"]').querySelectorAll('button')]
    const i = options.indexOf(option) + (event.key === 'ArrowDown' ? 1 : -1)
    options[(i + options.length) % options.length]?.focus()
  })

  syncControls()
  return { set, syncDetected, applyStrings }
}
