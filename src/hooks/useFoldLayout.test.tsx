// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useFoldLayout } from './useFoldLayout'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('accounts for the header above a horizontal fold and tracks layout changes', () => {
  let folded = true
  let top = 58
  let onChange: () => void = () => {}
  let onResize: () => void = () => {}
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return folded
    },
    addEventListener: (_: string, fn: () => void) => {
      onChange = fn
    },
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(fn: () => void) {
        onResize = fn
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ top }) as DOMRect,
  )

  function Layout() {
    const ref = useFoldLayout()
    return (
      <main>
        <header />
        <div ref={ref} data-testid="panels" />
      </main>
    )
  }
  const { getByTestId } = render(<Layout />)
  const panels = getByTestId('panels')
  expect(panels.style.getPropertyValue('--panels-top')).toBe('58px')
  act(() => {
    top = 76
    onResize()
  })
  expect(panels.style.getPropertyValue('--panels-top')).toBe('76px')
  act(() => {
    folded = false
    onChange()
  })
  expect(panels.style.getPropertyValue('--panels-top')).toBe('')
  act(() => {
    folded = true
    top = 50
    onChange()
  })
  expect(panels.style.getPropertyValue('--panels-top')).toBe('50px')
})

it('leaves the normal responsive layout alone when fold features are unavailable', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  function Layout() {
    const ref = useFoldLayout()
    return <div ref={ref} data-testid="panels" />
  }
  const { getByTestId } = render(<Layout />)
  expect(getByTestId('panels').style.getPropertyValue('--panels-top')).toBe('')
})
