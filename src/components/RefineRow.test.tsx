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
import { translationRequestKey } from '../lib/translationRequestKey'
import type { LiveResult, TranslateArgs } from '../hooks/useTranslate'

vi.mock('../hooks/useTranslate', async () => {
  const reactModule = await import('react')
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
  function useTranslate(args: TranslateArgs) {
    const [live, setLive] = reactModule.useState(currentLive)
    reactModule.useEffect(() => {
      listeners.add(setLive)
      return () => {
        listeners.delete(setLive)
      }
    }, [])
    const [error, setError] = reactModule.useState(currentError)
    reactModule.useEffect(() => {
      errorListeners.add(setError)
      return () => {
        errorListeners.delete(setError)
      }
    }, [])
    // Default fixtures model an immediate completed provider response. An
    // explicit requestKey freezes provenance for stale-settings regressions.
    const requestKey = translationRequestKey({ ...args, uiLang: 'en' })
    const keyedLive = reactModule.useMemo(() => {
      const result = live as LiveResult | null
      return result?.requestKey
        ? result
        : result
          ? { ...result, requestKey }
          : null
    }, [live, requestKey])
    return {
      live: keyedLive,
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

let currentContext: ReturnType<typeof useTranslatorContext>

function Setup({ text }: { text: string }) {
  const ctx = useTranslatorContext()
  currentContext = ctx
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

  it('chips toggle: click activates, second click removes the adjustment', async () => {
    renderRow('see you tomorrow')
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })
    const chip = await screen.findByTestId('refine-chip-softer')
    expect(chip.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    // The chip stays in place as the active affordance — no tags row.
    expect(screen.queryByTestId('refine-active-0')).toBeNull()

    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('false')
  })

  it('free-text Enter replaces the input with a truncated custom button; clicking it restores the input', async () => {
    renderRow('see you tomorrow')
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })
    fireEvent.click(await screen.findByTestId('refine-custom-trigger'))
    const input = (await screen.findByTestId(
      'refine-freeform',
    )) as unknown as HTMLInputElement
    // 26 chars — must truncate to 20 + ellipsis on the button label.
    fireEvent.change(input, {
      target: { value: 'less textbook-y and warmer' },
    })
    fireEvent.keyDown(input, { key: 'Enter' })

    const custom = await screen.findByTestId('refine-custom')
    expect(custom.textContent).toBe('less textbook-y and …')
    expect(screen.queryByTestId('refine-freeform')).toBeNull()

    fireEvent.click(custom)
    expect(screen.queryByTestId('refine-custom')).toBeNull()
    expect(await screen.findByTestId('refine-freeform')).toBeTruthy()
  })

  it('caps at 3 adjustments: remaining chips and the free-text input become disabled', async () => {
    renderRow('see you tomorrow')
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })
    fireEvent.click(await screen.findByTestId('refine-chip-softer'))
    fireEvent.click(screen.getByTestId('refine-chip-direct'))
    fireEvent.click(screen.getByTestId('refine-chip-shorter'))

    const playful = screen.getByTestId('refine-chip-playful')
    expect((playful as unknown as HTMLButtonElement).disabled).toBe(true)
    const input = screen.getByTestId(
      'refine-freeform',
    ) as unknown as HTMLInputElement
    expect(input.disabled).toBe(true)
    // Active chips stay enabled so any of them can be toggled back off.
    expect(
      (screen.getByTestId('refine-chip-softer') as unknown as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('keeps static refinement controls disabled while a sentence is incomplete', async () => {
    renderRow('see you tomorrow')
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: false,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })
    const chip =
      await screen.findByTestId<HTMLButtonElement>('refine-chip-softer')
    const custom = screen.getByTestId<HTMLButtonElement>(
      'refine-custom-trigger',
    )
    expect(chip.disabled).toBe(true)
    expect(custom.disabled).toBe(true)
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })
    expect(screen.getByTestId('refine-chip-softer')).toBe(chip)
    expect(chip.disabled).toBe(false)
  })

  it.each(['tone', 'target', 'context'] as const)(
    'disables known refinements while the completed result has stale %s settings',
    async (setting) => {
      renderRow('see you tomorrow')
      const result = {
        intent: 'sentence' as const,
        partial: { main: '내일 봐요' },
        done: true,
        requestSource: 'auto' as const,
        text: 'see you tomorrow',
        requestKey: translationRequestKey({
          ...currentContext,
          text: currentContext.input,
          uiLang: 'en',
        }),
      }
      await setMockLive(result)
      const chip =
        await screen.findByTestId<HTMLButtonElement>('refine-chip-softer')
      expect(chip.disabled).toBe(false)
      act(() => {
        if (setting === 'tone') currentContext.setMode('professional')
        else if (setting === 'target') currentContext.setTarget('ja')
        else currentContext.setContext('Replying to a colleague.')
      })
      expect(screen.getByTestId('refine-chip-softer')).toBe(chip)
      expect(chip.disabled).toBe(true)
      fireEvent.click(chip)
      expect(currentContext.refinements).toEqual([])
      await setMockLive({
        ...result,
        requestKey: translationRequestKey({
          ...currentContext,
          text: currentContext.input,
          uiLang: 'en',
        }),
      })
      expect(chip.disabled).toBe(false)
    },
  )

  it('renders nothing without a completed sentence result', () => {
    renderRow('see you tomorrow')
    expect(screen.queryByTestId('refine-chip-softer')).toBeNull()
  })

  it('shows a compact inline notice and stays visible when a refine fails', async () => {
    renderRow('see you tomorrow')
    await setMockLive({
      requestKey: translationRequestKey({
        ...currentContext,
        text: currentContext.input,
        uiLang: 'en',
      }),
      intent: 'sentence',
      partial: { main: '내일 봐요' },
      done: true,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })
    const chip = await screen.findByTestId('refine-chip-softer')
    // Triggers TranslatorContext's addRefinement, which pushes an undo
    // snapshot and marks a refine in flight.
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('true')

    // Simulate the refine's run rejecting — TranslatorContext's
    // error-rollback effect fires, stashes the error into `refineError`,
    // and restores the pre-refine snapshot (clearing the hook `error`).
    await setMockError({ kind: 'server', message: 'boom' })

    const notice = await screen.findByTestId('refine-error')
    expect(notice.textContent).toContain('boom')
    // The row itself stays rendered and the rolled-back chip reads inactive —
    // the failure is a compact inline notice, not a replacement of the row.
    expect(
      screen.getByTestId('refine-chip-softer').getAttribute('aria-pressed'),
    ).toBe('false')
  })
})
