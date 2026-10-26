// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ListenButton from './ListenButton'
import { UiLangProvider } from '../hooks/useUiLang'

const transport = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('../server/speech', () => ({ speak: transport }))

describe('ListenButton', () => {
  beforeEach(() => {
    localStorage.clear()
    transport.mockReset().mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal(
      'AudioContext',
      class {
        resume() {
          return Promise.resolve()
        }
        close() {
          return Promise.resolve()
        }
      },
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  const button = (disabled = false) =>
    render(
      <UiLangProvider>
        <ListenButton
          text="Hello from button"
          language="en"
          disabled={disabled}
        />
      </UiLangProvider>,
    )

  it('offers an icon-only accessible listen action without autoplay', () => {
    button()
    const listen = screen.getByRole('button', { name: 'Listen' })
    expect(listen.textContent).toBe('')
    expect(listen.getAttribute('data-testid')).toBe('listen-button')
    expect(transport).not.toHaveBeenCalled()
  })

  it('lets a second tap cancel while loading', async () => {
    button()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Listen' }))
    })
    const loading = screen.getByRole('button', {
      name: 'Loading audio. Tap to stop.',
    })
    expect(loading.getAttribute('aria-pressed')).toBe('true')
    const signal = transport.mock.calls[0]![0].signal as AbortSignal
    fireEvent.click(loading)
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Listen' })).toBeTruthy()
  })

  it('announces a recoverable failure without revealing provider errors', async () => {
    transport.mockRejectedValueOnce(new Error('private provider body'))
    button()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Listen' }))
    })
    const error = screen.getByRole('status')
    expect(error.textContent).toBe("Couldn't play audio. Try again.")
    expect(
      screen
        .getByRole('button', { name: 'Listen' })
        .getAttribute('aria-describedby'),
    ).toBe(error.id)
  })

  it('uses Korean accessible labels and honors disabled state', () => {
    localStorage.setItem('ui-lang', 'ko')
    button(true)
    const listen = screen.getByRole<HTMLButtonElement>('button', {
      name: '듣기',
    })
    expect(listen.disabled).toBe(true)
    fireEvent.click(listen)
    expect(transport).not.toHaveBeenCalled()
  })
})
