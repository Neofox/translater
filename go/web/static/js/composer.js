// Source editor: run scheduling, routing helpers and keyboard shortcuts.
//
// Hand-written: debounce/IME/paste/blur scheduling is app policy (ports of
// src/hooks/useTranslate.ts and useTranslatorShortcuts.ts), and the routing
// helpers are ports of src/lib/{detectIntent,detectLanguage,
// resolveTranslationTarget}.ts. Latin-script language identification is left
// to the model (nt-source-lang): tinyld/light is 33 KB gzip, over the 10 KB
// allowance, so detectLanguage returns 'en' for any Latin text.

export const DEBOUNCE_MS = 800
export const FINISHED_DEBOUNCE_MS = 400
export const WARM_INTERVAL_MS = 2 * 60_000

// Sentence-final punctuation or an emoji, optionally followed by closing
// quotes/brackets. Never letters: Korean IMEs pass partial jamo through.
const FINISHED_TEXT =
  /(?:[.!?…。！？~～]|\p{Extended_Pictographic}[\p{Emoji_Modifier}️]*)['"’”)\]」』]*$/u

/** Debounce for text: shorter when it looks finished. */
export function debounceFor(text, ms) {
  return FINISHED_TEXT.test(text) ? Math.min(ms, FINISHED_DEBOUNCE_MS) : ms
}

const SENTENCE_TERMINATORS = /[.!?。！？…]/

/** 'word' for up to two tokens and 24 characters without terminators. */
export function detectIntent(text) {
  const trimmed = text.trim()
  if (!trimmed || SENTENCE_TERMINATORS.test(trimmed)) return 'sentence'
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  return tokens.length <= 2 && trimmed.length <= 24 ? 'word' : 'sentence'
}

const count = (text, re) => (text.match(re) ?? []).length

/** Script-based source language: CJK by character counts, Latin → 'en'. */
export function detectLanguage(text) {
  const t = text.trim()
  if (!t) return null
  const kana = count(t, /[぀-ゟ゠-ヿ]/g)
  const hangul = count(t, /[가-힯]/g)
  const hanzi = count(t, /[一-鿿]/g)
  const latin = count(t, /[A-Za-z]/g)
  const cjk = kana + hangul + hanzi
  if (cjk > 0 && cjk >= latin) {
    // Any kana means Japanese: kanji-heavy sentences would otherwise be zh.
    if (kana > 0 && kana + hanzi >= hangul) return 'ja'
    return hangul >= hanzi ? 'ko' : 'zh'
  }
  return latin === 0 ? null : 'en'
}

/**
 * Language that routes an Auto-source run. While the text is unchanged
 * since the current result's run, that run's own routing stays pinned
 * (live.detected): the model's later report (nt-source-lang) only relabels
 * the Auto chip, so the result's request key keeps matching and Copy/Listen
 * stay usable. Otherwise the model's report for this exact text wins over
 * the script heuristic.
 */
export function routingDetected({ source, text, live, model }) {
  if (source !== 'auto') return null
  const trimmed = text.trim()
  if (!trimmed) return null
  if (live && live.source === 'auto' && live.text === trimmed) return live.detected
  return model?.text === trimmed ? model.lang : detectLanguage(trimmed)
}

export const fallbackTargetFor =(detected) => (detected === 'en' ? 'ko' : 'en')

/** Auto source never translates into its own language. */
export function resolveTarget({ source, target, detected }) {
  return source === 'auto' && detected && detected === target
    ? fallbackTargetFor(detected)
    : target
}

/**
 * Wire the textarea and source actions to `app`:
 *   app.inputChanged({ immediate }) — the text changed (abort + reschedule)
 *   app.run(trigger)                — start a run now
 *   app.clearInput(), app.copyMain(), app.warm()
 */
export function initComposer(app, ta) {
  let timer = null
  let immediate = false
  let composing = false

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const schedule = () => {
    clearTimer()
    if (composing) return
    const text = ta.value
    if (!text.trim()) {
      immediate = false
      return
    }
    const delay = immediate ? 0 : debounceFor(text, DEBOUNCE_MS)
    immediate = false
    timer = setTimeout(() => {
      timer = null
      app.run('debounce')
    }, delay)
  }
  const changed = () => {
    resize()
    app.inputChanged()
    schedule()
  }

  // Abort and mark stale on every edit, including composition updates, but
  // schedule only once composition has ended.
  ta.addEventListener('compositionstart', () => {
    composing = true
    clearTimer()
  })
  ta.addEventListener('compositionend', () => {
    composing = false
    changed()
  })
  ta.addEventListener('input', (event) => {
    if (composing) {
      clearTimer()
      resize()
      app.inputChanged()
      return
    }
    changed()
  })
  // The paste's own input event consumes the flag; a paste that changes
  // nothing must not make the next keystroke immediate.
  ta.addEventListener('paste', () => {
    immediate = true
    setTimeout(() => {
      immediate = false
    })
  })
  ta.addEventListener('blur', (event) => {
    const next = event.relatedTarget
    if (next instanceof Element && next.closest('[data-input-action]')) return
    flush()
  })

  /** Run a pending debounced translation now. */
  function flush() {
    if (timer === null) return
    clearTimer()
    app.run('blur')
  }

  /** Replace the whole text; Paste runs without debounce, Swap debounced. */
  function replaceText(text, now = true) {
    ta.value = text
    ta.setSelectionRange(text.length, text.length)
    immediate = now
    changed()
  }

  /** A lookup (synonym): the same textarea gets `text` and a debounced
   * run, like typing it (TS lookupWord). */
  function setText(text, { focus: andFocus = false } = {}) {
    if (ta.value !== text) replaceText(text, false)
    if (andFocus) focus()
  }

  function focus() {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== ta) active.blur()
    ta.focus({ preventScroll: true })
  }

  for (const button of document.querySelectorAll('[data-input-action]'))
    // Keep focus (and the blur flush) in the editor.
    button.addEventListener('pointerdown', (event) => event.preventDefault())

  document.querySelector('[data-testid="paste-input"]')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return
      replaceText(text)
      focus()
    } catch {
      /* Keep the draft when clipboard access is unavailable. */
    }
  })
  document.querySelector('[data-testid="clear-input"]')?.addEventListener('click', () => {
    clearInput()
    focus()
  })

  function clearInput() {
    clearTimer()
    immediate = false
    ta.value = ''
    changed()
  }

  // Escape closes an open popover first; it clears the text only otherwise.
  const popoverOpen = () => {
    try {
      return Boolean(document.querySelector(':popover-open'))
    } catch {
      return false
    }
  }

  window.addEventListener('keydown', (event) => {
    // Keys during IME composition belong to the IME (Enter commits it).
    if (event.isComposing || composing) return
    const meta = event.metaKey || event.ctrlKey
    if (meta && event.key === 'Enter') {
      // One request only: the forced run replaces any pending debounce.
      event.preventDefault()
      clearTimer()
      app.run('force')
    } else if (meta && event.shiftKey && (event.key === 'c' || event.key === 'C')) {
      event.preventDefault()
      app.copyMain()
    } else if (meta && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault()
      ta.focus()
      ta.select()
    } else if (event.key === 'Escape' && ta.value && !popoverOpen()) {
      event.preventDefault()
      clearInput()
      ta.focus()
    }
  })

  // Boot a cold function instance when the user is about to translate.
  let lastWarm = Number.NEGATIVE_INFINITY
  const warm = () => {
    if (document.hidden) return
    const now = Date.now()
    if (now - lastWarm < WARM_INTERVAL_MS) return
    lastWarm = now
    app.warm()
  }
  document.addEventListener('focusin', warm)
  document.addEventListener('visibilitychange', warm)

  // Auto-grow between the CSS min and max heights (InputPanel.tsx).
  function resize() {
    ta.style.height = '0px'
    const style = getComputedStyle(ta)
    const min = parseFloat(style.minHeight) || 52
    const max = parseFloat(style.maxHeight) || 180
    const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
    ta.style.height = `${Math.max(min, Math.min(max, ta.scrollHeight + border))}px`
  }
  if (typeof ResizeObserver !== 'undefined' && ta.parentElement) {
    let width = ta.parentElement.clientWidth
    new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width
        requestAnimationFrame(resize)
      }
    }).observe(ta.parentElement)
  }
  resize()

  return { flush, clearTimer, schedule, replaceText, setText, clearInput, focus, resize }
}
