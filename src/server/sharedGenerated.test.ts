import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  PROMPT_TEMPLATES_PATH,
  RESULT_TYPES_PATH,
  promptTemplatesSource,
  resultTypesSource,
} from '../../scripts/generate-shared'

// Fails while the generated views of shared/translation/ are stale. Fix with
// `npm run shared:generate`, never by editing the generated files.
it('prompt templates module matches shared/translation/prompts', async () => {
  expect(await readFile(PROMPT_TEMPLATES_PATH, 'utf8')).toBe(
    await promptTemplatesSource(),
  )
})

// The Go app serializes few-shot assistants with json.Compact on the raw
// file bytes, which equals JSON.stringify only while the files keep
// JSON.stringify's escaping. Keep every shared JSON file in that form.
it('keeps shared JSON files in canonical JSON.stringify form', async () => {
  const root = fileURLToPath(
    new URL('../../shared/translation', import.meta.url),
  )
  const files = (await readdir(root, { recursive: true })).filter((f) =>
    f.endsWith('.json'),
  )
  expect(files.length).toBeGreaterThan(20)
  for (const file of files) {
    const raw = await readFile(join(root, file), 'utf8')
    expect(raw, file).toBe(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`)
  }
})

it('result types match shared/translation/schemas', async () => {
  expect(await readFile(RESULT_TYPES_PATH, 'utf8')).toBe(
    await resultTypesSource(),
  )
})

// go:embed cannot leave the Go module, so go/internal/contract/data is a
// committed copy. Fix with `cd go && go generate ./...`.
it('Go contract copy matches shared/translation', async () => {
  const src = fileURLToPath(
    new URL('../../shared/translation', import.meta.url),
  )
  const dst = fileURLToPath(
    new URL('../../go/internal/contract/data', import.meta.url),
  )
  const list = async (dir: string) =>
    (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(dir.length))
      .sort()
  const files = await list(src)
  expect(await list(dst)).toEqual(files)
  for (const file of files) {
    expect(await readFile(join(dst, file)), file).toEqual(
      await readFile(join(src, file)),
    )
  }
})
