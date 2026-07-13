import { describe, expect, it } from 'vitest'
import { langfuseUsageDetails } from './telemetry'

describe('langfuseUsageDetails', () => {
  it('turns inclusive OpenAI input into exclusive Langfuse buckets', () => {
    expect(
      langfuseUsageDetails({
        input: 2_500,
        cachedInput: 1_800,
        cacheWriteInput: 500,
        output: 300,
        total: 2_800,
      }),
    ).toEqual({
      input: 200,
      cache_read_input_tokens: 1_800,
      cache_write_input_tokens: 500,
      output: 300,
      total: 2_800,
    })
  })

  it('never emits a negative ordinary-input bucket', () => {
    expect(
      langfuseUsageDetails({
        input: 100,
        cachedInput: 100,
        cacheWriteInput: 10,
        output: 20,
        total: 120,
      }).input,
    ).toBe(0)
  })
})
