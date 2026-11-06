// Speech endpoint and fixtures (@speech). The Listen UI is covered by
// speech.spec.ts. Here POST /speech is driven directly against this worker's
// fake upstream, and the speech fixtures that speech.spec.ts pronounces are
// translated.
import {
  expect,
  fillSource,
  fixture,
  openApp,
  sentence,
  test,
  waitForDone,
  waitForMain,
} from './helpers'

test('POST /speech streams the fake tone as 24 kHz PCM @speech @engine', async ({
  request,
  fake,
}) => {
  const res = await request.post('/speech', {
    multipart: { text: '  안녕하세요  ', language: 'ko', uiLang: 'en' },
  })
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('audio/L16;rate=24000;channels=1')
  expect(res.headers()['cache-control']).toBe('no-store')
  const pcm = await res.body()
  expect(pcm.byteLength).toBe(12000)
  expect(pcm.readInt16LE(2)).toBeGreaterThan(0)
  const stats = await fake.stats()
  expect(stats).toMatchObject({
    speechRequests: 1,
    speechAborted: 0,
    requests: 0,
  })
  expect(await fake.speechBodies()).toEqual([
    {
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      input: '안녕하세요',
      instructions:
        'Read the text aloud in Korean with natural native pronunciation, at a clear, relaxed pace.',
      response_format: 'wav',
    },
  ])
})

test('POST /speech errors are localized JSON without provider text @speech @engine', async ({
  request,
  fake,
}) => {
  for (const [uiLang, message] of [
    ['en', 'Pronunciation failed. Please try again.'],
    ['ko', '발음을 재생하지 못했어요. 다시 시도해 주세요.'],
  ] as const) {
    const failed = await request.post('/speech', {
      multipart: { text: 'x [fx:speech-error]', language: 'en', uiLang },
    })
    expect(failed.status()).toBe(502)
    expect(await failed.json()).toEqual({ error: message })
    const invalid = await request.post('/speech', {
      multipart: { text: 'a'.repeat(4001), language: 'en', uiLang },
    })
    expect(invalid.status()).toBe(400)
    expect(await invalid.json()).toEqual({ error: message })
  }
  // Invalid input never reaches upstream; each provider failure is one call.
  expect((await fake.stats()).speechRequests).toBe(2)
})

test('speech fixtures translate with their markers and never autoplay @speech @engine', async ({
  page,
  fake,
}) => {
  await openApp(page)
  for (const name of [
    'speech-slow',
    'speech-error',
    'speech-big',
    'speech-long',
  ]) {
    const fx = fixture(name)
    await fillSource(page, sentence(name))
    await waitForMain(page, fx.result.main!)
    await waitForDone(page)
    expect(fx.result.main).toContain(fx.match)
    if (name === 'speech-long') expect(fx.result.main!.length).toBe(4001)
    else
      for (const alt of fx.result.alternatives ?? [])
        expect(alt.text).toContain(fx.match)
  }
  expect((await fake.stats()).speechRequests).toBe(0)
})
