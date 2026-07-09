// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslatorProvider } from '../context/TranslatorContext'
import { UiLangProvider } from '../hooks/useUiLang'
import InputPanel from './InputPanel'

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

function renderPanel() {
  return render(
    <UiLangProvider>
      <TranslatorProvider>
        <InputPanel />
      </TranslatorProvider>
    </UiLangProvider>,
  )
}

describe('ContextField', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as never
  })
  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('toggle opens the context textarea, typing persists to sessionStorage', () => {
    renderPanel()
    expect(screen.queryByTestId('context-textarea')).toBeNull()
    fireEvent.click(screen.getByTestId('context-toggle'))
    const ta = screen.getByTestId('context-textarea')
    fireEvent.change(ta, { target: { value: '회의 몇 시에 해요?' } })
    expect(window.sessionStorage.getItem('nt.context')).toBe(
      JSON.stringify('회의 몇 시에 해요?'),
    )
  })

  it('clear button empties the context and keeps the field open', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('context-toggle'))
    fireEvent.change(screen.getByTestId('context-textarea'), {
      target: { value: 'hello' },
    })
    fireEvent.click(screen.getByTestId('context-clear'))
    // @ts-expect-error - testing library types don't narrow to HTMLTextAreaElement
    expect(screen.getByTestId('context-textarea').value).toBe('')
  })
})
