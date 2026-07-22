import { describe, expect, it } from 'vitest'
import { characterCountBucket } from './translationDimensions'

describe('characterCountBucket', () => {
  it.each([
    [0, '0'],
    [1, '1-24'],
    [24, '1-24'],
    [25, '25-100'],
    [100, '25-100'],
    [101, '101-500'],
    [500, '101-500'],
    [501, '501-2000'],
    [2_000, '501-2000'],
    [2_001, '2001+'],
  ] as const)('buckets %i characters as %s', (count, expected) => {
    expect(characterCountBucket(count)).toBe(expected)
  })
})
