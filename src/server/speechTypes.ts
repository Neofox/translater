import { z } from 'zod'

export const MAX_SPEECH_CHARS = 4000
export const MAX_SPEECH_AUDIO_BYTES = 8 * 1024 * 1024

export const SpeechInput = z.object({
  text: z.string().trim().min(1).max(MAX_SPEECH_CHARS),
  language: z.enum(['en', 'ko', 'ja', 'fr', 'es', 'zh', 'auto']),
  uiLang: z.enum(['en', 'ko']).default('en'),
})

export type SpeechInputData = z.infer<typeof SpeechInput>

export type SpeechChunk =
  { type: 'audio'; audio: Uint8Array; sampleRate: number } | { type: 'done' }
