// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AdjustMenu from './AdjustMenu'
import { UiLangProvider } from '../hooks/useUiLang'
const fixture = vi.hoisted(() => ({
  live: { intent: 'sentence' },
  input: 'Hello',
  refinements: ['make it softer'],
  refineError: null,
}))
vi.mock('../context/TranslatorContext', () => ({
  useTranslatorContext: () => fixture,
}))
vi.mock('./RefineRow', () => ({
  default: () => <input aria-label="Custom adjustment" />,
}))
afterEach(cleanup)
it('shows active adjustments while collapsed and retains a custom draft through collapse', () => {
  render(<AdjustMenu />, { wrapper: UiLangProvider })
  const trigger = screen.getByRole('button', { name: /Adjust.*Softer/ })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  const custom = screen.getByRole<HTMLInputElement>('textbox', {
    name: 'Custom adjustment',
  })
  fireEvent.change(custom, { target: { value: 'gentler please' } })
  fireEvent.click(trigger)
  fireEvent.click(trigger)
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(
    'gentler please',
  )
})
