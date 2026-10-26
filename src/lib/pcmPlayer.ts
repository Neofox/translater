import { MAX_SPEECH_AUDIO_BYTES } from '../server/speechTypes'

// About 175 seconds at 24 kHz mono. Both scheduling and replay collection
// enforce this bound; arbitrary provider output cannot grow memory forever.
export const MAX_AUDIO_BYTES = MAX_SPEECH_AUDIO_BYTES

/** Signed 16-bit little-endian mono PCM, scheduled on the browser audio clock. */
export class PcmPlayer {
  private readonly sources = new Set<AudioBufferSourceNode>()
  private pendingByte: number | undefined
  private sampleRate: number | undefined
  private bytes = 0
  private samples = 0
  private nextTime = 0
  private ended = false
  private stopped = false
  private resolveFinished!: () => void
  private readonly finished = new Promise<void>((resolve) => {
    this.resolveFinished = resolve
  })

  constructor(private readonly context: AudioContext) {}

  /** Call directly in the gesture stack, before awaiting network work. */
  resume() {
    return this.context.resume()
  }

  append(audio: Uint8Array, sampleRate: number) {
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
    if (this.bytes > MAX_AUDIO_BYTES)
      throw new Error('Audio exceeds playback limit')
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
      const low =
        index === 0 && hasPending ? this.pendingByte! : audio[offset++]!
      const high = audio[offset++]!
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

  endInput() {
    if (this.pendingByte !== undefined || !this.samples) {
      throw new Error('Incomplete PCM audio')
    }
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

  private maybeFinish() {
    if (this.ended && this.sources.size === 0) this.resolveFinished()
  }
}
