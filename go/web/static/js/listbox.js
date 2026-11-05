// The More… language listboxes' keyboard and pointer behaviour: Select.tsx
// with Floating UI's useListNavigation (loop, roving tabindex, focus on
// hover) and useTypeahead (matching each option's searchLabel).
//
// Hand-written: the spec rules out Floating UI; this is its observable
// behaviour for one plain list, checked against the TS app. prefs.js fills,
// places and selects; float.js closes a list that focus leaves.

const RESET_MS = 750
const OPTION = '[role="option"]'

/** One useTypeahead keystroke. `state` is {typed, at, prev, matched} (prev:
 * the selected or active index the search starts after, -1 for none);
 * returns the next state plus `index`, the matching option or -1. A new
 * search starts after `prev`; repeating a first letter cycles through its
 * matches unless a label repeats its first letter; a miss or RESET_MS of
 * quiet starts over. */
export function typeahead(state, key, labels, now) {
  let { typed, prev, matched } = state
  if (typed && now - state.at > RESET_MS) {
    typed = ''
    prev = matched
  }
  const rapid = labels.every((t) => t[0]?.toLocaleLowerCase() !== t[1]?.toLocaleLowerCase())
  if (rapid && typed === key) {
    typed = ''
    prev = matched
  }
  typed += key
  const start = (prev || 0) + 1
  const lower = typed.toLocaleLowerCase()
  const hit = [...labels.slice(start), ...labels.slice(0, start)].find((t) => t.toLocaleLowerCase().startsWith(lower))
  const index = hit === undefined ? -1 : labels.indexOf(hit)
  if (index >= 0) matched = index
  else if (key !== ' ') typed = ''
  return { typed, at: now, prev, matched, index }
}

const isOpen = (el) => {
  try {
    return el.matches(':popover-open')
  } catch {
    return false
  }
}

/** Wire every [role=listbox][popover] and its trigger. `searchLabel(option)`
 * is the text typeahead matches. Returns `opened(list)`, which prefs.js
 * calls once a list is open and placed. */
export function initListbox(searchLabel) {
  let ta = { typed: '', at: 0, prev: -1, matched: null }
  // The key that opened a list from its trigger; null for a pointer.
  let openKey = null
  // Floating UI's pointer modality: off after a key, on after a mouse move.
  let pointer = true
  const listOf = (el) => (el instanceof Element ? el.closest('[role="listbox"][popover]') : null)
  const items = (list) => [...list.querySelectorAll(OPTION)]
  const selectedIndex = (list) => items(list).findIndex((o) => o.getAttribute('aria-selected') === 'true')

  /** The active option (-1: none, the list itself holds focus) gets the
   * only tabindex 0 and Select's active background (bg-panel-2); typeahead
   * starts after it while nobody types. */
  function activate(list, index, now) {
    for (const [i, o] of items(list).entries()) {
      o.tabIndex = i === index ? 0 : -1
      o.classList.toggle('bg-panel-2', i === index)
    }
    if (!ta.typed || now - ta.at > RESET_MS) {
      const selected = selectedIndex(list)
      ta = { ...ta, typed: '', prev: selected >= 0 ? selected : index }
    }
  }
  const focusItem = (list, index) => (items(list)[index] ?? list).focus({ preventScroll: pointer })

  function opened(list) {
    list.tabIndex = -1
    ta = { typed: '', at: 0, prev: -1, matched: null }
    const n = items(list).length
    const selected = selectedIndex(list)
    // A pointer leaves no active option; a key makes the first (the last
    // for ArrowUp) active, though focus stays on the list.
    const active = selected >= 0 ? selected : openKey === null ? -1 : openKey === 'ArrowUp' ? n - 1 : 0
    activate(list, active, 0)
    if (selected >= 0) focusItem(list, selected)
    else list.focus({ preventScroll: true })
    openKey = null
  }

  document.addEventListener('pointerdown', () => (openKey = null), true)
  document.addEventListener('keydown', (event) => {
    const target = event.target
    const trigger = target instanceof Element && target.closest('[aria-haspopup="listbox"][popovertarget]')
    if (trigger) {
      const list = document.getElementById(trigger.getAttribute('popovertarget'))
      pointer = false
      if (list && !isOpen(list) && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) openKey = event.key
      if (!list || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
      event.preventDefault()
      if (!isOpen(list)) return list.showPopover({ source: trigger })
      const index = event.key === 'ArrowDown' ? 0 : items(list).length - 1
      activate(list, index, event.timeStamp)
      return focusItem(list, index)
    }
    const list = listOf(target)
    if (!list) return
    pointer = false
    const all = items(list)
    const n = all.length
    const i = all.indexOf(target)
    let next
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = n - 1
    else if (event.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % n
    else if (event.key === 'ArrowUp') next = i < 0 ? n - 1 : (i - 1 + n) % n
    if (next !== undefined) {
      event.preventDefault()
      activate(list, next, event.timeStamp)
      return focusItem(list, next)
    }
    // Space on an option selects it (Select's own item handler runs first).
    if (event.key === ' ' && i >= 0) return
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
    const labels = all.map(searchLabel)
    const live = ta.typed && event.timeStamp - ta.at <= RESET_MS ? ta.typed : ''
    const matching = live && live[0] !== ' ' && labels.some((t) => t.toLocaleLowerCase().startsWith(live.toLocaleLowerCase()))
    if (event.key !== ' ' || matching) event.preventDefault()
    ta = typeahead(ta, event.key, labels, event.timeStamp)
    if (ta.index >= 0) {
      activate(list, ta.index, event.timeStamp)
      focusItem(list, ta.index)
    }
  })

  // Focus on an option makes it active; on the list itself or the trigger,
  // nothing is.
  document.addEventListener('focusin', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const id = target.getAttribute('aria-haspopup') === 'listbox' && target.getAttribute('popovertarget')
    const list = id ? document.getElementById(id) : listOf(target)
    if (!list || target === list || !isOpen(list)) return
    activate(list, items(list).indexOf(target), event.timeStamp)
  })
  // Hover focuses an option; leaving it hands focus back to the list.
  document.addEventListener('mousemove', (event) => {
    const option = event.target instanceof Element && event.target.closest(OPTION)
    if (!listOf(event.target)) return
    pointer = true
    if (option && document.activeElement !== option) option.focus({ preventScroll: true })
  })
  document.addEventListener('pointerout', (event) => {
    const option = event.target instanceof Element && event.target.closest(OPTION)
    const list = listOf(option)
    if (!list || !pointer || event.pointerType === 'touch' || option.contains(event.relatedTarget)) return
    activate(list, -1, event.timeStamp)
    list.focus({ preventScroll: true })
  })

  return opened
}
