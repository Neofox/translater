// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TranslatorProvider,
  useTranslatorContext,
} from '../context/TranslatorContext'
import { UiLangProvider } from '../hooks/useUiLang'
import RefineRow from './RefineRow'

vi.mock('../hooks/useTranslate', async () => {
  const React = await import('react')
  let currentLive: unknown = null
  const listeners = new Set<(v: unknown) => void>()
  function applyMockLive(v: unknown) {
    currentLive = v
    listeners.forEach((fn) => fn(v))
  }
  let currentError: unknown = null
  const errorListeners = new Set<(v: unknown) => void>()
  function applyMockError(v: unknown) {
    currentError = v
    errorListeners.forEach((fn) => fn(v))
  }
  function useTranslate() {
    const [live, setLive] = React.useState(currentLive)
    React.useEffect(() => {
      listeners.add(setLive)
      return () => {
        listeners.delete(setLive)
      }
    }, [])
    const [error, setError] = React.useState(currentError)
    React.useEffect(() => {
      errorListeners.add(setError)
      return () => {
        errorListeners.delete(setError)
      }
    }, [])
    return {
      live,
      isPending: false,
      streaming: false,
      error,
      run: () => Promise.resolve(),
      reset: () => {},
      flush: () => false,
      queueImmediate: () => {},
      restore: (v: unknown) => {
        applyMockError(null)
        applyMockLive(v)
      },
    }
  }
  return {
    useTranslate,
    __setMockLive: applyMockLive,
    __setMockError: applyMockError,
  }
})

async function setMockLive(v: unknown) {
  const mod = (await import('../hooks/useTranslate')) as unknown as {
    __setMockLive: (v: unknown) => void
  }
  act(() => mod.__setMockLive(v))
}

async function setMockError(v: unknown) {
  const mod = (await import('../hooks/useTranslate')) as unknown as {
    __setMockError: (v: unknown) => void
  }
  act(() => mod.__setMockError(v))
}

function Setup({ text }: { text: string }) {
  const ctx = useTranslatorContext()
  const { setInput } = ctx
  React.useEffect(() => {
    setInput(text)
  }, [setInput, text])
  return <RefineRow />
}

function renderRow(text: string) {
  return render(
    <UiLangProvider>
      <TranslatorProvider>
        <Setup text={text} />
      </TranslatorProvider>
    </UiLangProvider>,
  )
}

describe('RefineRow', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
    await setMockLive(null)
    await setMockError(null)
  })
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('clicking a chip moves it to the active-refinement tags', async () => {
    renderRow('see you tomorrow')
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      meta: null,
      text: 'see you tomorrow',
    })
    const chip = await screen.findByTestId('refine-chip-softer')
    fireEvent.click(chip)
    expect(await screen.findByTestId('refine-active-0')).toBeTruthy()
    expect(screen.queryByTestId('refine-chip-softer')).toBeNull()
    // undo appears once a refinement was applied
    expect(screen.getByTestId('refine-undo')).toBeTruthy()
  })

  it('free-text Enter adds a refinement and clears the field', async () => {
    renderRow('see you tomorrow')
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      meta: null,
      text: 'see you tomorrow',
    })
    const input = (await screen.findByTestId(
      'refine-freeform',
    )) as unknown as HTMLInputElement
    fireEvent.change(input, { target: { value: 'less textbook-y' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByTestId('refine-active-0')).toBeTruthy()
    expect(input.value).toBe('')
  })

  it('renders nothing without a completed sentence result', () => {
    renderRow('see you tomorrow')
    expect(screen.queryByTestId('refine-chip-softer')).toBeNull()
  })

  it('shows a compact inline notice and stays visible when a refine fails', async () => {
    renderRow('see you tomorrow')
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      meta: null,
      text: 'see you tomorrow',
    })
    const chip = await screen.findByTestId('refine-chip-softer')
    // Triggers TranslatorContext's addRefinement, which pushes an undo
    // snapshot and marks a refine in flight.
    fireEvent.click(chip)
    expect(await screen.findByTestId('refine-active-0')).toBeTruthy()

    // Simulate the refine's run rejecting — TranslatorContext's
    // error-rollback effect fires, stashes the error into `refineError`,
    // and restores the pre-refine snapshot (clearing the hook `error`).
    await setMockError({ kind: 'server', message: 'boom' })

    const notice = await screen.findByTestId('refine-error')
    expect(notice.textContent).toContain('boom')
    // The row itself (chips) stays rendered — the failure is a compact
    // inline notice, not a replacement of the whole row.
    expect(screen.getByTestId('refine-chip-softer')).toBeTruthy()
    expect(screen.queryByTestId('refine-active-0')).toBeNull()
  })
})
