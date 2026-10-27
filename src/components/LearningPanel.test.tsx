// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LearningPanel from './LearningPanel'
import { UiLangProvider } from '../hooks/useUiLang'
import {
  COMPACT_LAYOUT,
  WorkspaceLayoutContext,
} from '../context/WorkspaceLayoutContext'

const fixture = vi.hoisted(() => ({ minimized: true, setMinimized: vi.fn() }))
vi.mock('../context/LearningContext', () => ({
  useLearningContext: () => ({
    ...fixture,
    isOpen: true,
    selectedChunk: null,
    close: vi.fn(),
  }),
}))
vi.mock('./LearningInspector', () => ({
  default: () => <p>Sentence overview</p>,
}))
afterEach(cleanup)
it('allows a deliberate restore in a short stacked window without keyboard occlusion', () => {
  const tree = (
    <UiLangProvider>
      <WorkspaceLayoutContext.Provider
        value={{ ...COMPACT_LAYOUT, short: true }}
      >
        <LearningPanel />
      </WorkspaceLayoutContext.Provider>
    </UiLangProvider>
  )
  const { rerender } = render(tree)
  const show = screen.getByRole<HTMLButtonElement>('button', {
    name: 'Show learning',
  })
  expect(show.disabled).toBe(false)
  fireEvent.click(show)
  expect(fixture.setMinimized).toHaveBeenCalledWith(false)
  fixture.minimized = false
  rerender(
    <UiLangProvider>
      <WorkspaceLayoutContext.Provider
        value={{ ...COMPACT_LAYOUT, short: true }}
      >
        <LearningPanel />
      </WorkspaceLayoutContext.Provider>
    </UiLangProvider>,
  )
  expect(screen.getByText('Sentence overview').closest('[hidden]')).toBeNull()
})

it('offers the learning content inside the result scroll at tight heights', () => {
  fixture.minimized = false
  render(
    <UiLangProvider>
      <WorkspaceLayoutContext.Provider
        value={{ ...COMPACT_LAYOUT, short: true, tight: true }}
      >
        <div data-testid="tight-learning-slot" />
        <LearningPanel />
      </WorkspaceLayoutContext.Provider>
    </UiLangProvider>,
  )
  expect(screen.getByText('Sentence overview').closest('[hidden]')).toBeNull()
  expect(
    screen
      .getByText('Sentence overview')
      .closest('[data-testid="tight-learning-slot"]'),
  ).not.toBeNull()
})
