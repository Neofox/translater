import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  handleSpeech,
  resolveSpeechConfig,
} from '../src/server/speech.server.ts'

// Deliberate real request; never run this as part of the regression suite.
const output = resolve(
  process.argv[2] ?? join(tmpdir(), 'neotranslate-speech.wav'),
)
try {
  const started = Date.now()
  const stream = await handleSpeech(
    { text: '안녕하세요. 만나서 반가워요.', language: 'ko', uiLang: 'en' },
    new AbortController().signal,
  )
  const chunks = []
  let sampleRate = 0
  let done = false
  for await (const part of stream) {
    if (part.type === 'done') done = true
    else {
      chunks.push(part.audio)
      sampleRate = part.sampleRate
    }
  }
  const pcm = Buffer.concat(chunks)
  if (!done || !pcm.length || !sampleRate) throw new Error('Incomplete speech')
  const header = Buffer.alloc(44)
  header.write('RIFF')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  await writeFile(output, Buffer.concat([header, pcm]))
  console.log(
    JSON.stringify({
      model: resolveSpeechConfig().model,
      output,
      sampleRate,
      audioBytes: pcm.length,
      seconds: pcm.length / (sampleRate * 2),
      elapsedMs: Date.now() - started,
    }),
  )
} catch {
  console.error(
    'Speech smoke failed. Check OPENAI_API_KEY, SPEECH_MODEL and SPEECH_VOICE. No automatic retry was made.',
  )
  process.exitCode = 1
}
