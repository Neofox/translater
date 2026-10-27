// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import SettingsMenu from './SettingsMenu'
import { UiLangProvider } from '../hooks/useUiLang'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})
it('makes UI language available in settings and persists an explicit language choice', async () => {
  render(<SettingsMenu />, { wrapper: UiLangProvider })
  expect(screen.queryByRole('group', { name: 'UI language' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  await waitFor(() =>
    expect(screen.getByRole('group', { name: 'UI language' })).toBeTruthy(),
  )
  fireEvent.click(screen.getByRole('button', { name: '한' }))
  expect(window.localStorage.getItem('ui-lang')).toBe('ko')
})
