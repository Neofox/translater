import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useServerFn } from '@tanstack/react-start'
import { speak } from '../server/speech'
import type { SpeechChunk } from '../server/speechTypes'
import { MAX_SPEECH_CHARS } from '../server/speechTypes'
import { MAX_AUDIO_BYTES, PcmPlayer } from '../lib/pcmPlayer'
import { LANGUAGES } from '../lib/languages'
import { useUiLang } from './useUiLang'

type AudioChunk = Extract<SpeechChunk, { type: 'audio' }>
type CachedAudio = { chunks: AudioChunk[]; bytes: number }
type ActivePlayback = {
  controller: AbortController
  player: PcmPlayer
  reader?: ReadableStreamDefaultReader<SpeechChunk>
  stop: () => void
}
export type SpeechOptions = {
  text: string
  language: string
  disabled?: boolean
  resetKey?: string
}
export type SpeechStatus = 'idle' | 'loading' | 'playing'
type SpeechError = 'speechFailed' | 'speechUnavailable' | 'speechTooLong'

// Completed audio only, scoped to this page's module lifetime. Redeployment
// changes to the server-selected model/voice take effect after a page reload.
const replayCache = new Map<string, CachedAudio>()
const MAX_CACHE_BYTES = 4 * 1024 * 1024
const MAX_CACHE_ENTRIES = 3
let cacheBytes = 0
// Set only by browser gestures. Main and alternative controls share one voice.
let pagePlayback: ActivePlayback | null = null

function cacheAudio(key: string, audio: CachedAudio) {
  if (audio.bytes > MAX_CACHE_BYTES) return
  const previous = replayCache.get(key)
  if (previous) cacheBytes -= previous.bytes
  replayCache.delete(key)
  replayCache.set(key, audio)
  cacheBytes += audio.bytes
  while (cacheBytes > MAX_CACHE_BYTES || replayCache.size > MAX_CACHE_ENTRIES) {
    const oldest = replayCache.keys().next().value!
    cacheBytes -= replayCache.get(oldest)!.bytes
    replayCache.delete(oldest)
  }
}

export function useSpeech({
  text,
  language,
  disabled = false,
  resetKey,
}: SpeechOptions) {
  const speakFn = useServerFn(speak)
  const { lang: uiLang } = useUiLang()
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const [error, setError] = useState<SpeechError | null>(null)
  const active = useRef<ActivePlayback | null>(null)

  const cancel = useCallback(() => {
    const current = active.current
    active.current = null
    if (!current) return
    if (pagePlayback === current) pagePlayback = null
    current.controller.abort()
    void current.reader?.cancel().catch(() => {})
    current.player.stop()
  }, [])

  const stop = useCallback(() => {
    cancel()
    setStatus('idle')
    setError(null)
  }, [cancel])

  // Reset before the updated button can be painted and tapped. A passive
  // effect can otherwise cancel a new playback started on the fresh result.
  useLayoutEffect(() => {
    stop()
    return cancel
  }, [text, language, disabled, resetKey, stop, cancel])

  // BFCache navigation can retain the mounted React tree. Silence the page
  // before it is frozen; returning to it still requires another explicit tap.
  useEffect(() => {
    window.addEventListener('pagehide', stop)
    return () => window.removeEventListener('pagehide', stop)
  }, [stop])

  const start = useCallback(() => {
    if (disabled || !text.trim() || active.current) return
    setError(null)
    if (text.trim().length > MAX_SPEECH_CHARS) {
      setError('speechTooLong')
      return
    }
    let player: PcmPlayer | undefined
    let resumed: Promise<void>
    try {
      const audioGlobals = globalThis as {
        AudioContext?: typeof AudioContext
        webkitAudioContext?: typeof AudioContext
      }
      const AudioContextClass =
        audioGlobals.AudioContext ?? audioGlobals.webkitAudioContext
      if (!AudioContextClass) {
        setError('speechUnavailable')
        return
      }
      player = new PcmPlayer(new AudioContextClass())
      // This call must stay before the first await: iPhone requires the
      // AudioContext to be unlocked within the explicit user gesture.
      resumed = player.resume()
    } catch {
      player?.stop()
      setError('speechUnavailable')
      return
    }
    const playback = player
    const current: ActivePlayback = {
      player: playback,
      controller: new AbortController(),
      stop,
    }
    pagePlayback?.stop()
    pagePlayback = current
    active.current = current
    setStatus('loading')
    const isCurrent = () =>
      active.current === current && !current.controller.signal.aborted
    const key = JSON.stringify([text, language])

    void (async () => {
      try {
        await resumed
        // Stop may happen while resume is still pending. Never start the
        // paid request after that cancellation, even if resume later succeeds.
        if (!isCurrent()) return
        const cached = replayCache.get(key)
        if (cached) {
          replayCache.delete(key)
          replayCache.set(key, cached)
          for (const chunk of cached.chunks)
            playback.append(chunk.audio, chunk.sampleRate)
          setStatus('playing')
          await playback.endInput()
        } else {
          const selectedLanguage =
            LANGUAGES.find((entry) => entry.code === language)?.code ?? 'auto'
          const stream = await speakFn({
            data: { text, language: selectedLanguage, uiLang },
            signal: current.controller.signal,
          })
          if (!isCurrent()) {
            void stream.cancel().catch(() => {})
            return
          }
          const reader = stream.getReader()
          current.reader = reader
          const chunks: AudioChunk[] = []
          let bytes = 0
          let complete = false
          let next = await reader.read()
          while (!next.done) {
            if (!isCurrent()) return
            if (complete) throw new Error('Audio after completion')
            if (next.value.type === 'done') {
              complete = true
            } else {
              const chunk = next.value
              bytes += chunk.audio.byteLength
              if (bytes > MAX_AUDIO_BYTES)
                throw new Error('Audio exceeds playback limit')
              if (playback.append(chunk.audio, chunk.sampleRate))
                setStatus('playing')
              chunks.push({ ...chunk, audio: chunk.audio.slice() })
            }
            next = await reader.read()
          }
          if (!isCurrent()) return
          if (!complete) throw new Error('Incomplete audio stream')
          const finished = playback.endInput()
          cacheAudio(key, { chunks, bytes })
          await finished
        }
        if (isCurrent()) {
          active.current = null
          if (pagePlayback === current) pagePlayback = null
          playback.stop()
          setStatus('idle')
        }
      } catch {
        if (isCurrent()) {
          cancel()
          setStatus('idle')
          // Never display raw provider messages, which may contain input.
          setError('speechFailed')
        }
      } finally {
        if (current.reader) {
          try {
            current.reader.releaseLock()
          } catch {
            /* A cancellation is still settling. */
          }
        }
      }
    })()
  }, [disabled, text, language, uiLang, speakFn, cancel, stop])

  const toggle = useCallback(() => {
    if (active.current) stop()
    else start()
  }, [start, stop])

  return { status, error, start, stop, toggle }
}
