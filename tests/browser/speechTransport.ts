import type { SpeechChunk } from '../../src/server/speechTypes'

export function speak(): Promise<ReadableStream<SpeechChunk>> {
  throw new Error('Browser fixtures must provide a synthetic speech stream')
}
