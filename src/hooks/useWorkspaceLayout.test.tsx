// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkspaceLayout } from './useWorkspaceLayout'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('tracks the visible keyboard height and releases viewport listeners on unmount', () => {
  const viewport = Object.assign(new EventTarget(), { height: 736 })
  const remove = vi.spyOn(viewport, 'removeEventListener')
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(594)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    () => viewport.height - 64,
  )
  function Workspace() {
    const { panelsRef, layout } = useWorkspaceLayout()
    return (
      <main className="app-shell" data-testid="shell">
        <div
          ref={panelsRef}
          data-testid="panels"
          data-layout={layout.mode}
          data-tight={layout.tight}
        />
      </main>
    )
  }
  const { getByTestId, unmount } = render(<Workspace />)
  const shell = getByTestId('shell')
  const panels = getByTestId('panels')
  expect(shell.style.getPropertyValue('--app-height')).toBe('736px')
  expect(panels.getAttribute('data-layout')).toBe('stack')
  act(() => {
    viewport.height = 320
    viewport.dispatchEvent(new Event('resize'))
  })
  expect(shell.style.getPropertyValue('--app-height')).toBe('320px')
  expect(panels.getAttribute('data-layout')).toBe('split')
  expect(panels.getAttribute('data-tight')).toBe('true')
  act(() => {
    viewport.height = 736
    viewport.dispatchEvent(new Event('resize'))
  })
  expect(panels.getAttribute('data-layout')).toBe('stack')
  expect(panels.getAttribute('data-tight')).toBe('false')
  unmount()
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  expect(shell.style.getPropertyValue('--app-height')).toBe('')
})

it('chooses the compact layout from usable width when the background extends into side insets', () => {
  vi.stubGlobal(
    'visualViewport',
    Object.assign(new EventTarget(), { height: 736 }),
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(736)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(672)
  function Workspace() {
    const { panelsRef, layout } = useWorkspaceLayout()
    return (
      <main
        className="app-shell"
        ref={(element) => {
          element?.style.setProperty('--safe-area-right', '160px')
        }}
      >
        <div
          ref={panelsRef}
          data-testid="panels"
          data-result-first={layout.resultFirst}
        />
      </main>
    )
  }
  const { getByTestId } = render(<Workspace />)
  expect(getByTestId('panels').getAttribute('data-result-first')).toBe('true')
})
