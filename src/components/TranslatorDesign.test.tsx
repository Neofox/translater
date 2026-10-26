// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import InputPanel from './InputPanel'
import { TranslatorProvider } from '../context/TranslatorContext'
import { UiLangProvider } from '../hooks/useUiLang'

vi.mock('../hooks/useTranslate', () => ({
  useTranslate: () => ({
    live: null,
    isPending: false,
    streaming: false,
    error: null,
    run: () => Promise.resolve(),
    reset: () => {},
    flush: () => false,
    queueImmediate: () => {},
    restore: () => {},
  }),
}))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: vi.fn().mockResolvedValue('A new reply to translate.') },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderInput() {
  return render(
    <UiLangProvider>
      <TranslatorProvider>
        <InputPanel />
      </TranslatorProvider>
    </UiLangProvider>,
  )
}

it('keeps Paste available to replace a nonempty conversation turn', async () => {
  renderInput()
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Input text',
  })
  fireEvent.change(input, {
    target: { value: 'The previous conversation turn.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Paste clipboard' }))
  await waitFor(() => expect(input.value).toBe('A new reply to translate.'))
})

it('keeps Clear available on empty input and focuses the composer', () => {
  renderInput()
  fireEvent.click(screen.getByRole('button', { name: 'Clear input' }))
  expect(document.activeElement).toBe(
    screen.getByRole('textbox', { name: 'Input text' }),
  )
})

it('clears the current turn while retaining replying context and input focus', () => {
  renderInput()
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Input text',
  })
  fireEvent.click(screen.getByTestId('context-toggle'))
  fireEvent.change(screen.getByTestId('context-textarea'), {
    target: { value: 'A friend asking about the weekend.' },
  })
  fireEvent.change(input, { target: { value: 'This weekend works for me.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Clear input' }))
  expect(input.value).toBe('')
  expect(
    screen.getByTestId<HTMLTextAreaElement>('context-textarea').value,
  ).toBe('A friend asking about the weekend.')
  expect(document.activeElement).toBe(input)
})

it('retains the current input if clipboard access is denied', async () => {
  vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error('Denied'))
  renderInput()
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Input text',
  })
  fireEvent.change(input, { target: { value: 'Keep this draft.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Paste clipboard' }))
  await waitFor(() => expect(input.value).toBe('Keep this draft.'))
})
