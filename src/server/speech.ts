import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { SpeechInput } from './speechTypes'
import type { SpeechChunk } from './speechTypes'

export type { SpeechChunk, SpeechInputData } from './speechTypes'

export const speak = createServerFn({ method: 'POST' })
  .validator(SpeechInput)
  .handler(async ({ data }): Promise<ReadableStream<SpeechChunk>> => {
    const { handleSpeech } = await import('./speech.server')
    return handleSpeech(data, getRequest().signal)
  })
