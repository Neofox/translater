// Proves the Go fake OpenAI server (go/internal/fakeopenai) speaks a Responses
// stream the production AI SDK path accepts, so browser tests never need a
// paid call. The fake is built once and started on a free port; no real API
// key is ever set.
import { spawn, execFileSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const fixtures = join(root, 'e2e/fixtures/results')

let child: ChildProcess
let workDir: string
let baseUrl: string
let streamText: typeof import('ai').streamText
let translationRequest: typeof import('../src/server/translationRequest').translationRequest
let resolveTranslateConfig: typeof import('../src/server/openai').resolveTranslateConfig
let classifyTranslationError: typeof import('../src/server/translationError').classifyTranslationError
let handleSpeech: typeof import('../src/server/speech.server').handleSpeech

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => ok(port))
    })
    s.on('error', fail)
  })
}

function fixture(name: string) {
  return JSON.parse(readFileSync(join(fixtures, `${name}.json`), 'utf8'))
}

function request(text: string, intent: 'sentence' | 'word' = 'sentence') {
  return translationRequest(
    {
      text,
      source: intent === 'word' ? 'en' : 'en',
      target: 'ko',
      mode: 'casual',
      intent,
      uiLang: 'en',
      context: '',
      refinements: [],
      previousMain: '',
      analyticsTrigger: 'debounce',
    },
    resolveTranslateConfig({}),
  )
}

async function stats() {
  return (await fetch(`${baseUrl}/_stats`)).json() as Promise<{
    requests: number
    aborted: number
    lastBodies: string[]
    speechRequests: number
    lastSpeechBodies: string[]
  }>
}

/** The production TS speech path against the fake: PCM bytes and rate. */
async function speak(text: string) {
  const stream = await handleSpeech(
    { text, language: 'ko', uiLang: 'en' },
    new AbortController().signal,
    { env: {} },
  )
  const chunks: Uint8Array[] = []
  const rates = new Set<number>()
  let done = false
  for await (const chunk of stream) {
    if (chunk.type === 'done') done = true
    else {
      chunks.push(chunk.audio)
      rates.add(chunk.sampleRate)
    }
  }
  return { pcm: Buffer.concat(chunks), rates: [...rates], done }
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'fakeopenai-'))
  const bin = join(workDir, 'fakeopenai')
  execFileSync('go', ['build', '-o', bin, './cmd/fakeopenai'], {
    cwd: join(root, 'go'),
  })
  const port = await freePort()
  baseUrl = `http://127.0.0.1:${port}`
  child = spawn(bin, ['-addr', `127.0.0.1:${port}`, '-fixtures', fixtures], {
    stdio: 'ignore',
  })
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${baseUrl}/_stats`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  // The provider reads these when it is created, i.e. at import time.
  process.env.OPENAI_BASE_URL = `${baseUrl}/v1`
  process.env.OPENAI_API_KEY = 'test'
  ;({ streamText } = await import('ai'))
  ;({ translationRequest } = await import('../src/server/translationRequest'))
  ;({ resolveTranslateConfig } = await import('../src/server/openai'))
  ;({ classifyTranslationError } = await import(
    '../src/server/translationError'
  ))
  ;({ handleSpeech } = await import('../src/server/speech.server'))
}, 60_000)

afterAll(() => {
  child?.kill()
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

describe('Go fake OpenAI upstream', () => {
  it('streams a sentence fixture the AI SDK parses into the exact result', async () => {
    const fx = fixture('plain')
    const result = streamText({ ...request(`hello ${fx.match}`) })
    expect(await result.output).toEqual(fx.result)
    const sent = (await stats()).lastBodies.at(-1) ?? ''
    expect(JSON.parse(sent).stream).toBe(true)
  }, 30_000)

  it('streams a word fixture', async () => {
    const fx = fixture('word')
    const result = streamText({ ...request(fx.match, 'word') })
    expect(await result.output).toEqual(fx.result)
  }, 30_000)

  it('survives markup and escape-splitting chunk boundaries', async () => {
    const fx = fixture('markup')
    const result = streamText({ ...request(fx.match) })
    const out = (await result.output) as { main: string }
    expect(out).toEqual(fx.result)
    expect(out.main).toContain('<img src=x onerror=alert(1)>')
  }, 30_000)

  it('reassembles surrogate pairs escaped across deltas', async () => {
    const fx = fixture('emoji')
    const result = streamText({ ...request(fx.match) })
    expect(await result.output).toEqual(fx.result)
  }, 30_000)

  it('maps 429 insufficient_quota to the budget error kind', async () => {
    const fx = fixture('error-budget')
    let captured: unknown
    const result = streamText({
      ...request(fx.match),
      onError: ({ error }) => {
        captured = error
      },
    })
    await result.consumeStream()
    expect(captured).toBeDefined()
    expect(classifyTranslationError(captured)).toBe('budget')
  })

  it('maps other fixture errors to their kinds', async () => {
    const expected = {
      'error-rate': 'rate_limit',
      'error-auth': 'authentication',
      'error-model': 'model_configuration',
      'error-provider': 'provider',
    } as const
    for (const [name, kind] of Object.entries(expected)) {
      let captured: unknown
      const result = streamText({
        ...request(fixture(name).match),
        onError: ({ error }) => {
          captured = error
        },
      })
      await result.consumeStream()
      expect(classifyTranslationError(captured), name).toBe(kind)
    }
  })

  it('counts an aborted request', async () => {
    await fetch(`${baseUrl}/_reset`, { method: 'POST' })
    const controller = new AbortController()
    const result = streamText({
      ...request(fixture('slow').match),
      abortSignal: controller.signal,
      onError: () => {},
    })
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        controller.abort()
        break
      }
    }
    for (let i = 0; i < 50 && (await stats()).aborted < 1; i++) {
      await new Promise((r) => setTimeout(r, 40))
    }
    expect((await stats()).aborted).toBe(1)
  }, 30_000)

  it('serves speech WAV the TS validator accepts as the 24 kHz tone', async () => {
    const before = (await stats()).speechRequests
    const { pcm, rates, done } = await speak('  안녕하세요  ')
    expect(done).toBe(true)
    expect(rates).toEqual([24000])
    expect(pcm.byteLength).toBe(12000)
    expect(pcm.readInt16LE(0)).toBe(0)
    expect(pcm.readInt16LE(2)).toBeGreaterThan(0)
    const after = await stats()
    expect(after.speechRequests).toBe(before + 1)
    const sent = JSON.parse(after.lastSpeechBodies.at(-1) ?? '{}')
    expect(sent).toMatchObject({
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      input: '안녕하세요',
      response_format: 'wav',
      instructions: expect.stringContaining('in Korean'),
    })
  }, 30_000)

  it('speech variants: big audio passes, errors and 8-bit WAV fail', async () => {
    expect((await speak('x [fx:speech-big]')).pcm.byteLength).toBe(2621440)
    await expect(speak('x [fx:speech-error]')).rejects.toThrow(
      'Pronunciation failed.',
    )
    await expect(speak('x [fx:speech-bad]')).rejects.toThrow(
      'Pronunciation failed.',
    )
  }, 30_000)
})
