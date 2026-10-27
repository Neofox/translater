import { expect, it } from 'vitest'
import { isInspectTap } from './phrasePointer'

const down = { x: 10, y: 10, time: 100 }
it('accepts only a short stationary single gesture without selected text', () => {
  expect(isInspectTap(down, { x: 12, y: 11, time: 250 }, '')).toBe(true)
  expect(isInspectTap(down, { x: 50, y: 10, time: 250 }, '')).toBe(false)
  expect(isInspectTap(down, { x: 10, y: 10, time: 700 }, '')).toBe(false)
  expect(isInspectTap(down, { x: 10, y: 10, time: 200 }, 'selected')).toBe(
    false,
  )
})
