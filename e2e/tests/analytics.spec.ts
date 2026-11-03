// Run analytics form fields (Task 29). The Go client sends the same
// telemetry-only fields as TS useTranslate (analyticsSessionId, the run it
// supersedes, the input revision and the trigger); the server puts them in
// Langfuse metadata only. TS sends them inside a server-function payload, so
// this checks the Go form posts.
import type { Page, Request } from '@playwright/test'
import { APP } from '../ports'
import {
  expect,
  fillSource,
  openApp,
  sentence,
  test,
  waitForDone,
  waitForStats,
} from './helpers'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The decoded fields of every POST /translate, in order. */
function recordRuns(page: Page): Record<string, string>[] {
  const runs: Record<string, string>[] = []
  page.on('request', (request: Request) => {
    if (request.method() !== 'POST' || !request.url().endsWith('/translate')) return
    const body = request.postData() ?? ''
    const type = request.headers()['content-type'] ?? ''
    if (type.startsWith('multipart/form-data')) {
      const fields: Record<string, string> = {}
      for (const m of body.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g))
        fields[m[1]!] = m[2]!
      runs.push(fields)
    } else {
      runs.push(Object.fromEntries(new URLSearchParams(body)))
    }
  })
  return runs
}

test('runs send the analytics fields @core', async ({ page, fake }) => {
  test.skip(APP === 'ts', 'TS sends them in a server-function payload')
  const runs = recordRuns(page)
  await openApp(page)

  // A slow run superseded by an edit names the run it replaces.
  await fillSource(page, sentence('slow'))
  await expect.poll(() => runs.length, { timeout: 15_000 }).toBe(1)
  await waitForStats(fake, (s) => s.requests >= 1, 15_000)
  await fillSource(page, sentence('default'))
  await expect.poll(() => runs.length, { timeout: 15_000 }).toBe(2)
  await waitForDone(page)

  const [first, second] = runs
  expect(first).toMatchObject({ trigger: 'debounce', inputRevision: '1', supersedesRunId: '' })
  expect(first!.analyticsSessionId).toMatch(UUID)
  expect(second).toMatchObject({
    trigger: 'debounce',
    inputRevision: '2',
    supersedesRunId: first!.run,
    analyticsSessionId: first!.analyticsSessionId,
  })

  // A forced run of the finished result supersedes nothing.
  await page.getByTestId('input-textarea').focus()
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect.poll(() => runs.length).toBe(3)
  expect(runs[2]).toMatchObject({ trigger: 'force', inputRevision: '2', supersedesRunId: '' })
  await waitForDone(page)
})
