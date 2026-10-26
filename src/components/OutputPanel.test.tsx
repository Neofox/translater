// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OutputPanel from './OutputPanel'
import { UiLangProvider } from '../hooks/useUiLang'

const fixture = vi.hoisted(() => ({
  input: 'Hello there',
  source: 'en',
  target: 'ko',
  mode: 'casual',
  context: '',
  refinements: [] as string[],
  isPolish: false,
  isPending: false,
  streaming: false,
  error: null as { message: string; kind: 'server' } | null,
  live: {
    intent: 'sentence',
    text: 'Hello there',
    done: false,
    partial: { main: '안녕하세요', targetLang: 'ko' },
  },
  setTarget: () => {},
}))

vi.mock('../context/TranslatorContext', () => ({
  useTranslatorContext: () => fixture,
}))
vi.mock('./LanguageChipBar', () => ({ default: () => null }))
vi.mock('./LearningTips', () => ({ default: () => null }))
vi.mock('./RefineRow', () => ({ default: () => null }))
vi.mock('./ListenButton', () => ({
  default: ({
    disabled,
    language,
  }: {
    disabled?: boolean
    language: string
  }) => <button disabled={disabled} aria-label={`Listen in ${language}`} />,
}))

beforeEach(() => {
  fixture.input = 'Hello there'
  fixture.live.done = false
  fixture.isPending = false
  fixture.streaming = false
  fixture.error = null
  window.localStorage.clear()
})
afterEach(cleanup)

it('offers pronunciation only when the translation is complete', () => {
  const { rerender } = render(<OutputPanel />, { wrapper: UiLangProvider })
  expect(screen.queryByRole('button', { name: 'Listen in ko' })).toBeNull()
  fixture.live.done = true
  rerender(<OutputPanel />)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Listen in ko' })
      .disabled,
  ).toBe(false)
})

it('disables stale pronunciation immediately when the input is edited or a run is pending', () => {
  fixture.live.done = true
  const { rerender } = render(<OutputPanel />, { wrapper: UiLangProvider })
  fixture.input = 'A new sentence'
  rerender(<OutputPanel />)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Listen in ko' })
      .disabled,
  ).toBe(true)
  fixture.input = fixture.live.text
  fixture.isPending = true
  rerender(<OutputPanel />)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Listen in ko' })
      .disabled,
  ).toBe(true)
})

it('removes pronunciation when the result fails', () => {
  fixture.live.done = true
  const { rerender } = render(<OutputPanel />, { wrapper: UiLangProvider })
  expect(screen.getByRole('button', { name: 'Listen in ko' })).toBeTruthy()
  fixture.error = { kind: 'server', message: 'Unavailable' }
  rerender(<OutputPanel />)
  expect(screen.queryByRole('button', { name: 'Listen in ko' })).toBeNull()
})
