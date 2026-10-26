/** Deterministic Web Audio clock: the real playback code schedules PCM, while
 * tests decide when the browser's final source emits its ended event. */
export class SyntheticAudioContext {
  static instances: SyntheticAudioContext[] = []
  currentTime = 0
  destination = {}
  sources: SyntheticSource[] = []
  closed = false

  constructor() {
    SyntheticAudioContext.instances.push(this)
  }

  resume() {
    return Promise.resolve()
  }
  close() {
    this.closed = true
    return Promise.resolve()
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }
  }

  createBufferSource() {
    const source = new SyntheticSource()
    this.sources.push(source)
    return source
  }

  finish() {
    for (const source of this.sources) source.onended?.()
  }
}

class SyntheticSource {
  buffer: unknown = null
  onended: (() => void) | null = null
  stopped = false
  connect() {}
  disconnect() {}
  start() {}
  stop() {
    this.stopped = true
    this.onended?.()
  }
}
