// @vitest-environment jsdom
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import InspectableTranslation from './InspectableTranslation'
import type * as PhrasePointer from '../lib/phrasePointer'

vi.mock('../lib/phrasePointer', async () => ({
  ...(await vi.importActual<typeof PhrasePointer>('../lib/phrasePointer')),
  textOffsetAtPoint: () => 1,
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.getSelection()?.removeAllRanges()
})
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
it('offers word details directly on the word with native keyboard activation', () => {
  const inspect = vi.fn()
  render(
    <InspectableTranslation
      text="안녕"
      language="ko"
      disabled={false}
      actionLabel="Word details: 안녕"
      expanded={false}
      onInspect={inspect}
    />,
  )
  const word = screen.getByRole('button', { name: 'Word details: 안녕' })
  fireEvent.click(word, { detail: 0 })
  expect(inspect).toHaveBeenCalledWith(0)
  expect(word.getAttribute('aria-expanded')).toBe('false')
})

function gesture(node: Element, type: string) {
  fireEvent(
    node,
    new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    }),
  )
}
it('cancels a pending phrase tap when the page is hidden', () => {
  vi.useFakeTimers()
  const inspect = vi.fn()
  render(
    <InspectableTranslation
      text="안녕"
      language="ko"
      disabled={false}
      onInspect={inspect}
    />,
  )
  const main = screen.getByTestId('main-translation')
  gesture(main, 'pointerdown')
  gesture(main, 'pointerup')
  fireEvent(window, new Event('pagehide'))
  act(() => vi.advanceTimersByTime(450))
  expect(inspect).not.toHaveBeenCalled()
})
it('a click dismissing an existing native selection does not inspect', () => {
  vi.useFakeTimers()
  const inspect = vi.fn()
  render(
    <InspectableTranslation
      text="안녕"
      language="ko"
      disabled={false}
      onInspect={inspect}
    />,
  )
  const main = screen.getByTestId('main-translation')
  const range = document.createRange()
  range.selectNodeContents(main)
  window.getSelection()?.addRange(range)
  gesture(main, 'pointerdown')
  window.getSelection()?.removeAllRanges()
  gesture(main, 'pointerup')
  act(() => vi.advanceTimersByTime(450))
  expect(inspect).not.toHaveBeenCalled()
})

it('invalidates a pending tap when request identity changes but the wording stays identical', () => {
  vi.useFakeTimers()
  const inspect = vi.fn()
  const props = {
    text: '안녕',
    language: 'ko',
    disabled: false,
    onInspect: inspect,
    resetKey: 'first request',
  }
  const { rerender } = render(<InspectableTranslation {...props} />)
  const main = screen.getByTestId('main-translation')
  gesture(main, 'pointerdown')
  gesture(main, 'pointerup')
  rerender(<InspectableTranslation {...props} resetKey="second request" />)
  act(() => vi.advanceTimersByTime(450))
  expect(inspect).not.toHaveBeenCalled()
})
