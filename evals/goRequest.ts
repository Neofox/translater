import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The evals measure the production request, which the Go app builds:
// cmd/request prints the exact Responses body for one translation, and
// with -prepare resolves learning phrases with the app's learning.Prepare.
// The command is built once per process and spawned per call.

const GO_MODULE = join(dirname(fileURLToPath(import.meta.url)), '..')

let binary: string | undefined

/** Path of the built cmd/request (synchronous, so checks can use it). */
function requestBinary(): string {
  if (!binary) {
    const dir = mkdtempSync(join(tmpdir(), 'neotranslate-request-'))
    const out = join(dir, 'request')
    execFileSync('go', ['build', '-o', out, './cmd/request'], {
      cwd: GO_MODULE,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    binary = out
  }
  return binary
}

export type PromptVariant = 'production' | 'lean' | 'lean-nochars'

export type TranslateInput = {
  text: string
  source: string
  target: string
  mode: string
  intent: string
  uiLang: string
  context: string
  refinements: string[]
  previousMain: string
}

export type RequestConfig = {
  model?: string
  reasoning?: string
  serviceTier?: string
}

export type RequestArgs = {
  input: TranslateInput
  config: RequestConfig
  variant?: PromptVariant
}

const MAX_BUFFER = 16 * 1024 * 1024

function failure(error: unknown, stderr: string): Error {
  const reason = stderr.trim()
  return new Error(
    reason || (error instanceof Error ? error.message : String(error)),
  )
}

/** The Responses request body (JSON text, stream: true) the app sends. */
export function requestBody(args: RequestArgs): Promise<string> {
  const bin = requestBinary()
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      [],
      { maxBuffer: MAX_BUFFER, encoding: 'utf8' },
      (error, stdout, stderr) =>
        error ? reject(failure(error, stderr)) : resolve(stdout),
    )
    child.stdin?.end(JSON.stringify(args))
  })
}

/** requestBody, synchronously (provider construction). */
export function requestBodySync(args: RequestArgs): string {
  try {
    return execFileSync(requestBinary(), [], {
      input: JSON.stringify(args),
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw failure(error, String((error as { stderr?: unknown }).stderr ?? ''))
  }
}

export type PreparedLearning = {
  /** At least one phrase resolved. */
  ok: boolean
  /** Some letter, number or symbol of the primary text is in no phrase. */
  partial: boolean
  /** Grammar highlights that resolved to ranges. */
  grammarHighlights: number
}

/** learning.Prepare on a sentence result's learningPhrases. */
export function prepareLearning(args: {
  counterpart: string
  primary: string
  phrases: unknown[]
}): PreparedLearning {
  try {
    return JSON.parse(
      execFileSync(requestBinary(), ['-prepare'], {
        input: JSON.stringify(args),
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    )
  } catch (error) {
    throw failure(error, String((error as { stderr?: unknown }).stderr ?? ''))
  }
}
