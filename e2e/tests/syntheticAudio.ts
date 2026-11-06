// Deterministic Web Audio for e2e. The app's real playback code decodes and
// schedules the PCM it receives; the test decides when an unlock resolves and when scheduled audio ends.
// Installed as an init script, so it replaces AudioContext before any page
// script runs (the app reads it at tap time).
import type { Page } from '@playwright/test'

export type AudioOptions = {
  /** Every resume() waits for `window.__audio.release()`. */
  holdResume?: boolean
}

/** What the page's synthetic audio saw (see `audioState`). */
export type AudioState = {
  /** AudioContexts created, oldest first: one per unlocked tap. */
  contexts: Array<{
    closed: boolean
    resumed: boolean
    sources: number
    /** Created and resume() called while a click was being dispatched:
     * iPhone unlocks audio only inside the user gesture. */
    inGesture: { created: boolean; resume: boolean }
  }>
}

export async function installSyntheticAudio(
  page: Page,
  options: AudioOptions = {},
): Promise<void> {
  await page.addInitScript((opts: AudioOptions) => {
    type Source = {
      buffer: unknown
      onended: (() => void) | null
      connect(): void
      disconnect(): void
      start(): void
      stop(): void
    }
    let held = Boolean(opts.holdResume)
    // window.event is the event being dispatched, here the tap's click.
    const inClick = () =>
      (window as unknown as { event?: Event }).event?.type === 'click'
    const waiting: Array<() => void> = []
    const instances: Context[] = []

    class Context {
      currentTime = 0
      destination = {}
      sources: Source[] = []
      closed = false
      resumed = false
      /** After finish(): later sources end as soon as they start. */
      finishing = false
      inGesture = { created: inClick(), resume: false }

      constructor() {
        instances.push(this)
      }
      resume() {
        this.inGesture.resume = inClick()
        const done = () => {
          this.resumed = true
        }
        if (!held) {
          done()
          return Promise.resolve()
        }
        return new Promise<void>((resolve) =>
          waiting.push(() => {
            done()
            resolve()
          }),
        )
      }
      close() {
        this.closed = true
        return Promise.resolve()
      }
      createBuffer(_channels: number, length: number, rate: number) {
        return {
          duration: length / rate,
          getChannelData: () => new Float32Array(length),
        }
      }
      createBufferSource(): Source {
        const context = this
        const source: Source = {
          buffer: null,
          onended: null,
          connect() {},
          disconnect() {},
          start() {
            if (context.finishing) queueMicrotask(() => source.onended?.())
          },
          stop() {
            source.onended?.()
          },
        }
        this.sources.push(source)
        return source
      }
      /** The browser's scheduled audio ends (now and for later chunks). */
      finish() {
        this.finishing = true
        for (const source of this.sources) source.onended?.()
      }
    }

    const w = window as unknown as Record<string, unknown>
    w.AudioContext = Context
    w.webkitAudioContext = Context
    w.__audio = {
      instances,
      /** End the newest context's audio. */
      finish() {
        instances.at(-1)?.finish()
      },
      hold() {
        held = true
      },
      /** Resolve every pending (and later) unlock. */
      release() {
        held = false
        for (const resolve of waiting.splice(0)) resolve()
      },
    }
  }, options)
}

export async function audioState(page: Page): Promise<AudioState> {
  return page.evaluate(() => {
    const audio = (
      window as unknown as {
        __audio: {
          instances: Array<{
            closed: boolean
            resumed: boolean
            sources: unknown[]
            inGesture: { created: boolean; resume: boolean }
          }>
        }
      }
    ).__audio
    return {
      contexts: audio.instances.map((c) => ({
        closed: c.closed,
        resumed: c.resumed,
        sources: c.sources.length,
        inGesture: { ...c.inGesture },
      })),
    }
  })
}

/** Ends the newest context's scheduled audio. */
export async function finishAudio(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __audio: { finish(): void } }).__audio.finish(),
  )
}

export async function releaseAudio(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __audio: { release(): void } }).__audio.release(),
  )
}
