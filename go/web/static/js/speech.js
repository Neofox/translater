// Listen: one page-wide voice for the main and alternative Listen buttons,
// streamed from POST /speech through pcm.js, with a replay cache of
// completed audio. Port of src/hooks/useSpeech.ts and ListenButton.tsx.
//
// Hand-written: the gesture-bound audio unlock, the single playback owner
// and the cache bounds are app policy; the rest is fetch and Web Audio.

import { MAX_AUDIO_BYTES, PcmPlayer } from './pcm.js'

export const MAX_SPEECH_CHARS = 4000
export const MAX_CACHE_BYTES = 4 * 1024 * 1024
const MAX_CACHE_ENTRIES = 3

export const replayKey = (text, language) => JSON.stringify([text, language])

/** The request language: one of `codes` (nt-data languages), otherwise auto. */
export const speechLanguage = (code, codes) => (codes.includes(code) ? code : 'auto')

/** Sample rate of an `audio/L16;rate=N;channels=1` response, or null. */
export function parseRate(contentType) {
  const match = /(?:^|;)\s*rate=(\d+)\s*(?:;|$)/i.exec(contentType ?? '')
  return match ? Number(match[1]) : null
}

/** Completed audio by replayKey: at most 3 entries and 4 MiB, least
 * recently used first out; an entry over 4 MiB is never kept. */
export function createReplayCache() {
  const entries = new Map()
  let bytes = 0
  return {
    get size() {
      return entries.size
    },
    get bytes() {
      return bytes
    },
    get(key) {
      const audio = entries.get(key)
      if (audio) {
        entries.delete(key)
        entries.set(key, audio)
      }
      return audio
    },
    set(key, audio) {
      if (audio.bytes > MAX_CACHE_BYTES) return
      const previous = entries.get(key)
      if (previous) bytes -= previous.bytes
      entries.delete(key)
      entries.set(key, audio)
      bytes += audio.bytes
      while (bytes > MAX_CACHE_BYTES || entries.size > MAX_CACHE_ENTRIES) {
        const [oldest, evicted] = entries.entries().next().value
        bytes -= evicted.bytes
        entries.delete(oldest)
      }
    },
  }
}

// Pill.tsx tone class strings: Listen is `active` while not idle.
const NEUTRAL = 'border-border bg-panel hover:border-accent/60'
const ACTIVE = 'border-accent/70 bg-accent-soft [&>svg]:text-accent'
// ListenButton.tsx's error notice.
const ERROR_CLASS =
  'absolute right-0 top-full z-20 mt-1 max-w-[calc(100vw-2rem)] truncate whitespace-nowrap rounded-md border border-border bg-panel px-2 py-1 text-xs text-ink shadow-sm'
const SELECTOR = '[data-testid="listen-button"]'

/**
 * Feed `player` the audio for `key`: replayed from `cache`, or POSTed to
 * /speech (`body`) and cached once the whole body has been read. Resolves
 * true once the input has ended and playback has finished or been stopped,
 * or false once `isCurrent()` turns false while loading (a stopped or
 * superseded voice: its late bytes are dropped). Throws on any
 * failure, a body cut short included, so nothing partial is cached.
 * `owner.reader` is set for cancellation; `playing()` runs at the first
 * audible chunk.
 */
export async function loadAudio({ key, body, player, cache, owner, isCurrent, playing, request = fetch }) {
  const cached = cache.get(key)
  if (cached) {
    for (const chunk of cached.chunks) player.append(chunk, cached.rate)
    playing()
    await player.endInput()
    return true
  }
  const res = await request('/speech', { method: 'POST', body, signal: owner.controller.signal })
  if (!isCurrent()) {
    void res.body?.cancel().catch(() => {})
    return false
  }
  const rate = parseRate(res.headers.get('Content-Type'))
  if (!res.ok || !res.body || !rate) throw new Error('Speech failed')
  const reader = res.body.getReader()
  owner.reader = reader
  const chunks = []
  let bytes = 0
  for (;;) {
    const next = await reader.read()
    // Late bytes after Stop (Vercel keeps generating) are dropped.
    if (!isCurrent()) return false
    if (next.done) break
    bytes += next.value.byteLength
    if (bytes > MAX_AUDIO_BYTES) throw new Error('Audio exceeds playback limit')
    if (player.append(next.value, rate)) playing()
    chunks.push(next.value)
  }
  const finished = player.endInput()
  cache.set(key, { chunks, bytes, rate })
  await finished
  return true
}

export function initSpeech(app, codes) {
  // Page memory only; a redeployed voice/model applies after a reload.
  const cache = createReplayCache()
  // The one playback (set only by a tap): { button, controller, player, reader }.
  let owner = null
  let errorIds = 0

  /** The text and language a Listen button pronounces (OutputPanel's
   * speech options): the current main, or its alternative row's text. */
  function speechOf(button) {
    const live = app.live
    const row = button.closest('[data-testid="alternative-item"]')
    const text = row
      ? (row.querySelector('.alternative-text')?.textContent ?? '')
      : (live?.main ?? '')
    return { text, language: live?.targetLang ?? live?.target ?? app.prefs.target }
  }

  function render(button, status) {
    // Chunks arrive many times a second; only a change touches the DOM.
    if (button._speechStatus === status) return
    button._speechStatus = status
    const active = status !== 'idle'
    const key = status === 'loading' ? 'speechLoading' : active ? 'stopListening' : 'listen'
    button.className = active
      ? button.className.replace(NEUTRAL, ACTIVE)
      : button.className.replace(ACTIVE, NEUTRAL)
    button.setAttribute('aria-label', app.t(key))
    button.title = app.t(key)
    if (button.dataset.tAttr) button.dataset.tAttr = `aria-label:${key} title:${key}`
    button.setAttribute('aria-pressed', String(active))
    button.setAttribute('aria-busy', String(status === 'loading'))
    // The icons are <svg>: SVGElement has no `hidden` property.
    const icon = status === 'loading' ? 'loading' : active ? 'stop' : 'listen'
    for (const svg of button.querySelectorAll('svg[data-icon]'))
      svg.toggleAttribute('hidden', svg.dataset.icon !== icon)
    const label = button.querySelector('[data-t]')
    if (label) {
      label.dataset.t = active ? 'stopSpeech' : key
      label.textContent = app.t(label.dataset.t)
    }
  }

  function setError(button, key) {
    const wrapper = button.parentElement
    wrapper.querySelector('[role="status"]')?.remove()
    if (!key) {
      button.removeAttribute('aria-describedby')
      return
    }
    const notice = document.createElement('span')
    notice.id = `speech-error-${++errorIds}`
    notice.setAttribute('role', 'status')
    notice.title = app.t(key)
    notice.className = ERROR_CLASS
    notice.textContent = app.t(key)
    wrapper.append(notice)
    button.setAttribute('aria-describedby', notice.id)
  }

  function cancel(current) {
    if (owner === current) owner = null
    current.controller.abort()
    current.reader?.cancel().catch(() => {})
    current.player.stop()
  }

  /** Silence the page: the owner goes idle and its notice clears. */
  function stop() {
    const current = owner
    if (!current) return
    cancel(current)
    render(current.button, 'idle')
    setError(current.button, null)
  }

  /** The result or its settings changed (useSpeech's reset effect). */
  function reset() {
    stop()
    for (const button of document.querySelectorAll(SELECTOR)) setError(button, null)
  }

  function start(button) {
    const { text, language } = speechOf(button)
    if (!text.trim()) return
    setError(button, null)
    if (text.trim().length > MAX_SPEECH_CHARS) return setError(button, 'speechTooLong')
    let player
    let resumed
    try {
      const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext
      if (!AudioContextClass) return setError(button, 'speechUnavailable')
      player = new PcmPlayer(new AudioContextClass())
      // Before the first await: iPhone unlocks audio only inside the tap.
      resumed = player.resume()
    } catch {
      player?.stop()
      return setError(button, 'speechUnavailable')
    }
    const current = { button, controller: new AbortController(), player }
    stop()
    owner = current
    render(button, 'loading')
    const isCurrent = () => owner === current && !current.controller.signal.aborted
    const key = replayKey(text, language)

    void (async () => {
      try {
        await resumed
        // Stopped during a slow unlock: never send the paid request.
        if (!isCurrent()) return
        const body = new FormData()
        body.set('text', text)
        body.set('language', speechLanguage(language, codes))
        body.set('uiLang', app.prefs.uiLang)
        const playing = () => render(button, 'playing')
        const ended = await loadAudio({ key, body, player, cache, owner: current, isCurrent, playing })
        if (ended && isCurrent()) {
          owner = null
          player.stop()
          render(button, 'idle')
        }
      } catch {
        if (isCurrent()) {
          cancel(current)
          render(button, 'idle')
          // Never the server's message, which may quote the input.
          setError(button, 'speechFailed')
        }
      } finally {
        try {
          current.reader?.releaseLock()
        } catch {
          /* A cancellation is still settling. */
        }
      }
    })()
  }

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest(SELECTOR)
    if (!button || button.disabled) return
    if (owner?.button === button) stop()
    else start(button)
  })
  // The back-forward cache can keep this page: silence it before it freezes.
  addEventListener('pagehide', reset)

  /** After the actions' enabled states changed: a disabled or replaced
   * button loses its voice and notice (the reset on `disabled`). */
  function sync() {
    if (owner && (owner.button.disabled || !owner.button.isConnected)) stop()
    for (const button of document.querySelectorAll(SELECTOR)) {
      if (button._speechDisabled !== undefined && button._speechDisabled !== button.disabled)
        setError(button, null)
      button._speechDisabled = button.disabled
    }
  }

  return { reset, sync }
}
