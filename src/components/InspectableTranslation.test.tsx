// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import InspectableTranslation from './InspectableTranslation'
afterEach(cleanup)
it('preserves exact translation text and highlights only the selected exact span', () => {
  render(
    <InspectableTranslation
      text={'오늘 도와줘서\n고마워요.'}
      language="ko"
      disabled={false}
      onInspect={vi.fn()}
      selectedChunk={{ start: 3, end: 7 }}
    />,
  )
  const main = screen.getByTestId('main-translation')
  expect(main.textContent).toBe('오늘 도와줘서\n고마워요.')
  expect(main.querySelector('mark')?.textContent).toBe('도와줘서')
})
it('never inspects an incomplete or stale result', () => {
  const inspect = vi.fn()
  render(
    <InspectableTranslation
      text="안녕"
      language="ko"
      disabled
      onInspect={inspect}
    />,
  )
  fireEvent.click(screen.getByTestId('main-translation'))
  expect(inspect).not.toHaveBeenCalled()
})
