import { streamText } from 'ai'
import type { TranslateConfig } from '../src/server/openai.ts'
import { translationRequest } from '../src/server/translationRequest.ts'
import type { TranslateInputData } from '../src/server/translateTypes.ts'

// Records the exact JSON body the AI SDK would POST to OpenAI for one
// translation request, without any network call: global fetch is replaced for
// the duration of the call and answers 400, so nothing is sent or billed.
// Shared by the golden capture script and the golden request test.
export async function captureRequestBody(
  data: TranslateInputData,
  config: TranslateConfig,
  sentenceSystem?: Parameters<typeof translationRequest>[2],
): Promise<unknown> {
  const original = globalThis.fetch
  const originalKey = process.env.OPENAI_API_KEY
  const bodies: unknown[] = []
  process.env.OPENAI_API_KEY = originalKey || 'capture-only-no-network'
  globalThis.fetch = async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(
      JSON.stringify({ error: { message: 'capture only', type: 'capture' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const result = streamText({
      ...translationRequest(data, config, sentenceSystem),
      onError: () => {},
    })
    try {
      for await (const _delta of result.textStream) {
        // Drain: the request is made lazily while the stream is consumed.
      }
    } catch {
      // The 400 answer is expected.
    }
  } finally {
    globalThis.fetch = original
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalKey
  }
  if (bodies.length !== 1) {
    throw new Error(`expected one request body, captured ${bodies.length}`)
  }
  return bodies[0]
}
