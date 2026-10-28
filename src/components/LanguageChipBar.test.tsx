// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import LanguageChipBar from './LanguageChipBar'
import { UiLangProvider } from '../hooks/useUiLang'

function stubWidth(initial: number) {
  let notify: (
    entries: Array<{ contentRect: { width: number } }>,
  ) => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: typeof notify) {
        notify = callback
      }
      observe() {
        notify([{ contentRect: { width: initial } }])
      }
      disconnect() {}
    },
  )
  return {
    fire(width: number) {
      act(() => notify([{ contentRect: { width } }]))
    },
  }
}

function renderBar(props: Partial<Parameters<typeof LanguageChipBar>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <UiLangProvider>
      <LanguageChipBar
        kind="source"
        value="auto"
        onChange={onChange}
        {...props}
      />
    </UiLangProvider>,
  )
  return { onChange }
}

const chip = (code: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-testid="lang-chip"][data-value="${code}"]`,
  )

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }))
  stubWidth(600)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LanguageChipBar', () => {
  it('keeps chips mounted and updates menu options after a panel narrows', () => {
    const width = stubWidth(600)
    renderBar({ value: 'ko' })
    const english = chip('en')
    expect(english).toBeTruthy()
    width.fire(180)
    expect(chip('ko')).toBeTruthy()
    expect(chip('en')).toBe(english)
    width.fire(600)
    expect(chip('en')).toBeTruthy()
    width.fire(180)
    fireEvent.mouseDown(screen.getByTestId('lang-more-trigger'))
    expect(
      document.querySelector('[data-testid="select-option"][data-value="en"]'),
    ).toBeTruthy()
  })

  it('source bar renders Auto, English, 한국어 chips and a more trigger', () => {
    renderBar()
    expect(chip('auto')).toBeTruthy()
    expect(chip('en')).toBeTruthy()
    expect(chip('ko')).toBeTruthy()
    expect(screen.getByTestId('lang-more-trigger')).toBeTruthy()
  })

  it('target bar has no Auto chip', () => {
    renderBar({ kind: 'target', value: 'ko' })
    expect(chip('auto')).toBeNull()
  })

  it('clicking a chip calls onChange with its code', () => {
    const { onChange } = renderBar()
    fireEvent.click(chip('en')!)
    expect(onChange).toHaveBeenCalledWith('en')
  })

  it('marks the selected chip with aria-pressed', () => {
    renderBar({ value: 'en' })
    expect(chip('en')!.getAttribute('aria-pressed')).toBe('true')
    expect(chip('auto')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('Auto chip shows the detected language inline', () => {
    renderBar({ detected: 'en' })
    expect(chip('auto')!.textContent).toContain('English')
  })

  it('a non-fixed selection appears as a recent chip', () => {
    renderBar({ value: 'ja' })
    expect(chip('ja')).toBeTruthy()
    expect(chip('ja')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps the selected chip available alongside CSS-managed candidates in a narrow bar', () => {
    stubWidth(220)
    renderBar({ value: 'en' })
    expect(chip('en')).toBeTruthy()
    expect(chip('auto')).toBeTruthy()
    expect(chip('ko')).toBeTruthy()
    expect(screen.getByTestId('lang-more-trigger')).toBeTruthy()
  })

  it('collapsed source bar offers auto in the more listbox when not selected', () => {
    stubWidth(220)
    renderBar({ value: 'en' })
    fireEvent.mouseDown(screen.getByTestId('lang-more-trigger'))
    expect(
      document.querySelector(
        '[data-testid="select-option"][data-value="auto"]',
      ),
    ).toBeTruthy()
  })

  it('collapsed target bar never offers auto', () => {
    stubWidth(220)
    renderBar({ kind: 'target', value: 'ko' })
    fireEvent.mouseDown(screen.getByTestId('lang-more-trigger'))
    expect(
      document.querySelector(
        '[data-testid="select-option"][data-value="auto"]',
      ),
    ).toBeNull()
    expect(
      document.querySelector('[data-testid="select-option"][data-value="en"]'),
    ).toBeTruthy()
  })
})
