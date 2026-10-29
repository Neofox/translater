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
it('keeps the full reading view open at short heights until explicitly closed', () => {
  render(
    <UiLangProvider>
      <WorkspaceLayoutContext.Provider
        value={{ ...COMPACT_LAYOUT, short: true }}
      >
        <LearningPanel />
      </WorkspaceLayoutContext.Provider>
    </UiLangProvider>,
  )
  expect(screen.getByText('Sentence overview').closest('[hidden]')).toBeNull()
  expect(
    screen.getByTestId('learning-panel').hasAttribute('data-expanded'),
  ).toBe(true)
  expect(screen.queryByRole('button', { name: 'Show learning' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Close learning' }))
})
it('keeps its independent reading surface at tight keyboard heights', () => {
  render(
    <UiLangProvider>
      <WorkspaceLayoutContext.Provider
        value={{ ...COMPACT_LAYOUT, short: true, tight: true, keyboard: true }}
      >
        <LearningPanel />
      </WorkspaceLayoutContext.Provider>
    </UiLangProvider>,
  )
  expect(screen.getByText('Sentence overview').closest('[hidden]')).toBeNull()
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Close learning' }),
  )
})
