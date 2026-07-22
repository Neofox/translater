import { describe, expect, it, vi } from 'vitest'
import { consumeStructuredStream } from './structuredStream'

async function* deltas() {
  yield '{"main":"hel'
  yield 'lo"}'
}

describe('consumeStructuredStream', () => {
  it('forwards raw text deltas and returns only the validated output', async () => {
    const onDelta = vi.fn()
    const onFirstToken = vi.fn()
    const validated = { main: 'hello' }
    const result = await consumeStructuredStream({
      textStream: deltas(),
      output: Promise.resolve(validated),
      onDelta,
      onFirstToken,
    })

    expect(onDelta.mock.calls).toEqual([['{"main":"hel'], ['lo"}']])
    expect(onFirstToken).toHaveBeenCalledTimes(1)
    expect(result).toBe(validated)
  })

  it('does not produce a terminal value when validation rejects', async () => {
    const validationError = new Error('invalid structured output')
    await expect(
      consumeStructuredStream({
        textStream: deltas(),
        output: Promise.reject(validationError),
        onDelta: vi.fn(),
        onFirstToken: vi.fn(),
      }),
    ).rejects.toBe(validationError)
  })
})
