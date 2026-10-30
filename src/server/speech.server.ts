import { generateSpeech } from 'ai'
import './aiSdkWarnings.server'
import { openai } from './openai'
import { MAX_SPEECH_AUDIO_BYTES, SpeechInput } from './speechTypes'
import type { SpeechChunk, SpeechInputData } from './speechTypes'

const SPEECH_TIMEOUT_MS = 90_000
const STREAMING_SIZE = 0xffffffff
const DEFAULT_SPEECH_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_SPEECH_VOICE = 'marin'

// OpenAI speech has no language parameter; the voice instructions carry it so
// short or mixed-script text is still read with native pronunciation.
const LANGUAGE_NAMES: Record<SpeechInputData['language'], string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  fr: 'French',
  es: 'Spanish',
  zh: 'Mandarin Chinese',
  auto: '',
}

type SpeechEnvironment = { SPEECH_MODEL?: string; SPEECH_VOICE?: string }

export function resolveSpeechConfig(env: SpeechEnvironment = process.env): {
  model: string
  voice: string
} {
  // Older deployments used Gateway ids; `openai/<id>` is the same model.
  const model = (env.SPEECH_MODEL?.trim() ?? DEFAULT_SPEECH_MODEL).replace(
    /^openai\//,
    '',
  )
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new Error('SPEECH_MODEL must be one exact OpenAI speech model id.')
  }
  const voice = env.SPEECH_VOICE?.trim()
  if (
    voice !== undefined &&
    (!voice ||
      voice.length > 200 ||
      Array.from(voice).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ))
  ) {
    throw new Error('SPEECH_VOICE must be a nonempty voice identifier.')
  }
  return { model, voice: voice ?? DEFAULT_SPEECH_VOICE }
}

export function speechInstructions(
  language: SpeechInputData['language'],
): string {
  const name = LANGUAGE_NAMES[language]
  return name
    ? `Read the text aloud in ${name} with natural native pronunciation, at a clear, relaxed pace.`
    : 'Read the text aloud with natural native pronunciation, at a clear, relaxed pace.'
}

type SpeechDependencies = {
  generateSpeech: (options: Parameters<typeof generateSpeech>[0]) => Promise<{
    audio: { uint8Array: Uint8Array }
  }>
  env: SpeechEnvironment
}

/** Accept complete mono PCM16 WAVs; discard container/provenance metadata. */
function pcmFromWav(wav: Uint8Array) {
  if (wav.byteLength < 44 || wav.byteLength > MAX_SPEECH_AUDIO_BYTES + 65536)
    throw new Error('Unsupported audio size')
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (offset: number) =>
    String.fromCharCode(...wav.subarray(offset, offset + 4))
  // OpenAI writes its WAV header before the audio exists, so the RIFF and data
  // sizes are the streaming placeholder 0xFFFFFFFF; the data then runs to the
  // end of the response.
  const riffSize = view.getUint32(4, true)
  if (
    tag(0) !== 'RIFF' ||
    tag(8) !== 'WAVE' ||
    (riffSize !== STREAMING_SIZE && riffSize + 8 !== wav.byteLength)
  )
    throw new Error('Incomplete WAV container')
  let sampleRate: number | undefined
  let pcm: Uint8Array | undefined
  let offset = 12
  while (offset < wav.byteLength) {
    if (offset + 8 > wav.byteLength) throw new Error('Incomplete WAV chunk')
    const kind = tag(offset)
    const declared = view.getUint32(offset + 4, true)
    const length =
      kind === 'data' && declared === STREAMING_SIZE
        ? wav.byteLength - offset - 8
        : declared
    const start = offset + 8
    const end = start + length
    const next = end + (length % 2)
    if (next > wav.byteLength) throw new Error('Incomplete WAV data')
    if (kind === 'fmt ') {
      if (sampleRate !== undefined || length < 16)
        throw new Error('Invalid WAV format')
      const rate = view.getUint32(start + 4, true)
      if (
        view.getUint16(start, true) !== 1 ||
        view.getUint16(start + 2, true) !== 1 ||
        view.getUint16(start + 14, true) !== 16 ||
        view.getUint16(start + 12, true) !== 2 ||
        view.getUint32(start + 8, true) !== rate * 2 ||
        rate < 8000 ||
        rate > 48000
      )
        throw new Error('Unsupported WAV format')
      sampleRate = rate
    } else if (kind === 'data') {
      if (pcm || !length || length % 2 || length > MAX_SPEECH_AUDIO_BYTES)
        throw new Error('Invalid PCM data')
      pcm = wav.subarray(start, end)
    }
    offset = next
  }
  if (!pcm || sampleRate === undefined) throw new Error('Missing PCM data')
  return { pcm, sampleRate }
}

function publicSpeechError(
  uiLang: SpeechInputData['uiLang'],
  configuration = false,
): Error {
  if (uiLang === 'ko') {
    return new Error(
      configuration
        ? '발음 재생 설정이 올바르지 않아요.'
        : '발음을 재생하지 못했어요. 다시 시도해 주세요.',
    )
  }
  return new Error(
    configuration
      ? 'Pronunciation is not configured correctly.'
      : 'Pronunciation failed. Please try again.',
  )
}

export async function handleSpeech(
  input: SpeechInputData,
  requestSignal: AbortSignal,
  dependencies: Partial<SpeechDependencies> = {},
): Promise<ReadableStream<SpeechChunk>> {
  const parsed = SpeechInput.safeParse(input)
  if (!parsed.success) throw publicSpeechError(input.uiLang)
  const data = parsed.data
  let config: ReturnType<typeof resolveSpeechConfig>
  try {
    config = resolveSpeechConfig(dependencies.env ?? process.env)
  } catch {
    throw publicSpeechError(data.uiLang, true)
  }

  const synthesize = dependencies.generateSpeech ?? generateSpeech
  const upstream = new AbortController()
  let output: ReadableStreamDefaultController<SpeechChunk>
  let terminal = false
  let audio: ReturnType<typeof pcmFromWav> | undefined
  let offset = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let ready!: () => void
  const generated = new Promise<void>((resolve) => {
    ready = resolve
  })

  function cleanup() {
    clearTimeout(timer)
    requestSignal.removeEventListener('abort', onAbort)
  }
  function stopUpstream() {
    // Never propagate a browser/provider reason containing source text.
    upstream.abort(new Error('Speech request ended.'))
    audio = undefined
    ready()
  }
  function fail() {
    if (terminal) return
    terminal = true
    cleanup()
    output.error(publicSpeechError(data.uiLang))
    stopUpstream()
  }
  function onAbort() {
    fail()
  }

  return new ReadableStream<SpeechChunk>(
    {
      start(controller) {
        output = controller
        if (requestSignal.aborted) {
          fail()
          return
        }
        requestSignal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(fail, SPEECH_TIMEOUT_MS)
        // OpenAI returns the complete WAV over HTTPS; PCM is forwarded only
        // after the whole container validates.
        // Do not return this promise from start: Stop must cancel while pending.
        void (async () => {
          try {
            const result = await synthesize({
              model: openai.speech(config.model),
              voice: config.voice,
              text: data.text,
              providerOptions: {
                openai: { instructions: speechInstructions(data.language) },
              },
              outputFormat: 'wav',
              maxRetries: 0,
              // A translation may have registered a global integration. Speech
              // must explicitly opt out, including input/output recording.
              telemetry: {
                isEnabled: false,
                recordInputs: false,
                recordOutputs: false,
              },
              abortSignal: upstream.signal,
            })
            if (terminal) return
            audio = pcmFromWav(result.audio.uint8Array)
            ready()
          } catch {
            fail()
          }
        })()
      },
      async pull(controller) {
        await generated
        if (terminal || !audio) return
        if (offset < audio.pcm.byteLength) {
          const end = Math.min(offset + 32768, audio.pcm.byteLength)
          controller.enqueue({
            type: 'audio',
            audio: audio.pcm.slice(offset, end),
            sampleRate: audio.sampleRate,
          })
          offset = end
        } else {
          terminal = true
          cleanup()
          audio = undefined
          controller.enqueue({ type: 'done' })
          controller.close()
        }
      },
      cancel() {
        if (terminal) return
        terminal = true
        cleanup()
        stopUpstream()
      },
    },
    { highWaterMark: 0 },
  )
}
