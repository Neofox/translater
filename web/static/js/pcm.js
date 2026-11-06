// Web Audio player for the /speech PCM stream.
//
// Hand-written: /speech answers audio/L16 but sends LITTLE-endian PCM16
// (RFC 2586 L16 is big-endian), so no generic L16 decoder applies; the rest
// is scheduling buffers on the browser's audio clock.

/** About 175 s at 24 kHz mono; scheduling and the replay cache share it. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024

/** Signed 16-bit little-endian mono PCM, scheduled on the audio clock. */
export class PcmPlayer {
  constructor(context) {
    this.context = context
    this.sources = new Set()
    this.pendingByte = undefined
    this.sampleRate = undefined
    this.bytes = 0
    this.samples = 0
    this.nextTime = 0
    this.ended = false
    this.stopped = false
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve
    })
  }

  /** Call directly in the gesture, before awaiting network work. */
  resume() {
    return this.context.resume()
  }

  /** Schedule `audio`; true when it produced audible samples. */
  append(audio, sampleRate) {
    if (this.stopped || this.ended) throw new Error('Playback ended')
    if (
      !Number.isInteger(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 96000 ||
      (this.sampleRate !== undefined && this.sampleRate !== sampleRate)
    )
      throw new Error('Unsupported PCM sample rate')
    this.sampleRate = sampleRate
    this.bytes += audio.byteLength
    if (this.bytes > MAX_AUDIO_BYTES) throw new Error('Audio exceeds playback limit')
    const hasPending = this.pendingByte !== undefined
    const count = Math.floor((audio.length + (hasPending ? 1 : 0)) / 2)
    if (!count) {
      if (audio.length) this.pendingByte = audio[0]
      return false
    }
    const buffer = this.context.createBuffer(1, count, sampleRate)
    const output = buffer.getChannelData(0)
    let offset = 0
    for (let index = 0; index < count; index++) {
      const low = index === 0 && hasPending ? this.pendingByte : audio[offset++]
      const high = audio[offset++]
      const unsigned = low | (high << 8)
      output[index] = (unsigned >= 32768 ? unsigned - 65536 : unsigned) / 32768
    }
    this.pendingByte = offset < audio.length ? audio[offset] : undefined
    this.samples += count
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.context.destination)
    this.sources.add(source)
    source.onended = () => {
      source.disconnect()
      this.sources.delete(source)
      this.maybeFinish()
    }
    const startTime = Math.max(this.context.currentTime + 0.02, this.nextTime)
    this.nextTime = startTime + buffer.duration
    source.start(startTime)
    return true
  }

  /** No more input: resolves once the last scheduled source has ended. */
  endInput() {
    if (this.pendingByte !== undefined || !this.samples) throw new Error('Incomplete PCM audio')
    this.ended = true
    this.maybeFinish()
    return this.finished
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    for (const source of this.sources) {
      source.onended = null
      try {
        source.stop()
      } catch {
        /* Already stopped by the browser. */
      }
      source.disconnect()
    }
    this.sources.clear()
    void this.context.close().catch(() => {})
    this.resolveFinished()
  }

  maybeFinish() {
    if (this.ended && this.sources.size === 0) this.resolveFinished()
  }
}
