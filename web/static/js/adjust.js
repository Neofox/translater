// Adjust: the header disclosure around the single refine row (refine.js).
// Its chips sit beside Tone when their measured width fits; otherwise a
// trigger opens them in a panel placed under it (float.js), clear of
// Copy/Listen. With a tight software keyboard the open Custom editor takes
// over the header itself (base.css), which then reserves the panel's height
// (--adjust-panel-height).
//
// Hand-written: the width rule, dismissal and focus moves are app rules.

import { autoUpdate, position } from './float.js'

/** The measured width rule: icon-only below 112 px; chips beside Tone when
 * the menu is at least 2 px wider than the buttons (with their column
 * gaps), the in-line label and its 14 px margin. */
export function fit(width, widths, gap, label) {
  const needed =
    widths.reduce((sum, w) => sum + w, 0) +
    Math.max(0, widths.length - 1) * gap +
    label +
    14
  return { iconOnly: width < 112, fits: needed > 0 && width >= needed + 2 }
}

/** Mount the menu from #adjust-template. `relabel(root)` applies the UI
 * language to the detached menu before it is inserted. Returns { menu,
 * show, sync, closeCustom }. */
export function initAdjust(app, ta, relabel) {
  const tpl = document.getElementById('adjust-template')
  const menu = tpl.content.firstElementChild
  const header = tpl.closest('.app-header')
  const shell = tpl.closest('.app-shell')
  const trigger = menu.querySelector('[data-testid="adjust-button"]')
  const [sliders, text, chevron] = trigger.children
  const content = menu.querySelector('.adjust-content')
  const controls = menu.querySelector('.refine-controls')
  const row = menu.querySelector('.refine-row')
  const label = menu.querySelector('.adjust-inline-label')
  const collapsed = menu.querySelector('.adjust-error')
  const tones = [trigger.className, trigger.dataset.activeClass]
  delete trigger.dataset.activeClass
  let open = false
  let beside = false
  let iconOnly = false
  let summary = ''
  let error = null
  let measured = null
  let unfloat = null

  const overlay = () =>
    !beside &&
    !(shell.hasAttribute('data-keyboard') && shell.hasAttribute('data-tight'))
  const flag = (el, name, on) =>
    on ? el.setAttribute(name, 'true') : el.removeAttribute(name)

  function place() {
    position(trigger, content, {
      placement: 'bottom-start',
      offset: 12,
      padding: 16,
      clearance: shell.querySelector('.primary-result-actions'),
      translate: true,
    })
  }

  /** Only the tight-keyboard editor reserves header space. */
  function reserve() {
    const on = open && !beside && !overlay()
    header.style.setProperty(
      '--adjust-panel-height',
      on ? `${content.getBoundingClientRect().height + 6}px` : '0px',
    )
  }

  function render() {
    if (!menu.isConnected) return
    const showing = open || beside
    const floating = overlay()
    const name = summary ? `${app.t('adjust')} · ${summary}` : app.t('adjust')
    flag(menu, 'data-inline', beside)
    trigger.className = tones[+Boolean(summary || open)]
    trigger.classList.toggle('adjust-trigger-compact', iconOnly)
    flag(trigger, 'data-active', summary)
    trigger.setAttribute('aria-expanded', open)
    trigger.setAttribute('aria-label', name)
    if (iconOnly) trigger.title = name
    else trigger.removeAttribute('title')
    trigger.style.display = beside ? 'none' : ''
    sliders.toggleAttribute('hidden', !iconOnly)
    chevron.toggleAttribute('hidden', iconOnly)
    chevron.classList.toggle('rotate-180', open)
    text.style.display = iconOnly ? 'none' : ''
    // Separate text nodes, the label then " · summary": one node would move
    // glyphs by subpixels (the visual baselines show it).
    if (text.textContent !== name)
      text.replaceChildren(
        app.t('adjust'),
        ...(summary ? [` · ${summary}`] : []),
      )
    flag(content, 'data-overlay', floating)
    flag(content, 'data-open', showing)
    flag(content, 'aria-hidden', !showing)
    content.inert = !showing
    const style = content.style
    if (floating) {
      // Fixed at the origin until place() moves it, whether or not it is open.
      style.position = 'fixed'
      style.left = style.top = '0px'
    } else
      for (const key of ['position', 'left', 'top', 'transform', 'will-change'])
        style.removeProperty(key)
    if (open && floating) {
      place()
      unfloat ??= autoUpdate(trigger, content, place)
    } else {
      unfloat?.()
      unfloat = null
    }
    const message = error === null ? [] : [app.t('refineFailed'), ': ', error]
    collapsed.hidden = showing || error === null
    collapsed.replaceChildren(...message)
    reserve()
  }

  /** Chips beside Tone when they fit. Keeps the last decision while the row
   * is hidden (after an error) or a short window shows only
   * the Custom editor. */
  function measure() {
    if (!menu.isConnected || row.hidden) return
    if (
      shell.hasAttribute('data-short') &&
      controls.querySelector('.refine-custom-editor:not([hidden])')
    )
      return
    // Hidden buttons are the inactive custom variant and take no width.
    const buttons = [...controls.querySelectorAll(':scope > button')].filter(
      (b) => !b.hidden,
    )
    const result = fit(
      menu.clientWidth,
      buttons.map((b) => b.getBoundingClientRect().width),
      parseFloat(getComputedStyle(controls).columnGap) || 0,
      label.getBoundingClientRect().width,
    )
    // Focus stays visible: chips focused while they stop fitting open the
    // panel; a focused trigger that disappears hands focus to the chips.
    const opens =
      !result.fits && !open && controls.contains(document.activeElement)
    if (opens) open = true
    const toChips = result.fits && !beside && document.activeElement === trigger
    const changed =
      opens || result.fits !== beside || result.iconOnly !== iconOnly
    beside = result.fits
    iconOnly = result.iconOnly
    if (changed || toChips) render()
    if (toChips)
      controls.querySelector(':scope > button')?.focus({ preventScroll: true })
  }

  const observer = new ResizeObserver(measure)
  observer.observe(menu)
  observer.observe(controls)
  let frame = 0
  new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => menu.isConnected && reserve())
  }).observe(content)

  function close() {
    open = false
    render()
  }

  trigger.addEventListener('click', () => {
    open = !open
    render()
  })
  // Escape inside the floating panel closes it and goes no further (the
  // composer's Escape would clear the source).
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open || beside) return
    event.stopPropagation()
    close()
    trigger.focus()
  })
  // Touch activation may leave focus outside the menu.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open || beside || !menu.isConnected) return
    close()
    trigger.focus({ preventScroll: true })
  })
  // After the click's own action (bubble phase), so a reflow cannot swallow
  // Copy. A control the click hid counts as outside the menu.
  document.addEventListener('click', (event) => {
    const target = event.target
    if (!open || beside || !(target instanceof Node)) return
    if (
      !menu.contains(target) ||
      (target instanceof Element && target.closest('[hidden]'))
    )
      close()
  })
  // Keyboard and tight flags decide between the panel and the header editor.
  document.addEventListener('nt-layout', render)

  /** Insert or remove the menu (present for a sentence result only);
   * removal forgets its open/inline state. */
  function show(on) {
    if (on === menu.isConnected) return
    if (on) {
      relabel(menu)
      tpl.before(menu)
      measured = null
      return
    }
    menu.remove()
    unfloat?.()
    unfloat = null
    open = beside = iconOnly = false
    header.style.removeProperty('--adjust-panel-height')
  }

  /** After the refine row updated: the summary of active adjustments, a refine
   * error message (or null), and what the width depends on. */
  function sync(next) {
    summary = next.summary
    error = next.error
    if (!ta.value.trim()) open = false
    render()
    const key = JSON.stringify([
      app.prefs.uiLang,
      next.refinements,
      next.intent,
      next.hasError,
    ])
    if (key !== measured) {
      measured = key
      measure()
    }
  }

  /** The Custom editor's Close: a panel closes with it; focus returns to
   * the source. */
  function closeCustom() {
    if (!beside) open = false
    render()
    ta.focus({ preventScroll: true })
  }

  return { menu, show, sync, closeCustom }
}
