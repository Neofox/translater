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
  function useTranslate() {
    const [live, setLive] = React.useState(currentLive)
    React.useEffect(() => {
      listeners.add(setLive)
      return () => {
        listeners.delete(setLive)
      }
    }, [])
    return {
      live,
      isPending: false,
      streaming: false,
      error: null,
      run: () => Promise.resolve(),
      reset: () => {},
      flush: () => false,
      queueImmediate: () => {},
      restore: (v: unknown) => applyMockLive(v),
    }
  }
  return { useTranslate, __setMockLive: applyMockLive }
})

async function setMockLive(v: unknown) {
  const mod = (await import('../hooks/useTranslate')) as unknown as {
    __setMockLive: (v: unknown) => void
  }
  act(() => mod.__setMockLive(v))
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
})
