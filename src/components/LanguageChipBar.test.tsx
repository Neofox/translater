// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import LanguageChipBar from './LanguageChipBar'
import { UiLangProvider } from '../hooks/useUiLang'

type Listener = (e: { matches: boolean }) => void

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches: initial,
    media: '',
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return {
    fire(matches: boolean) {
      mql.matches = matches
      listeners.forEach((cb) => cb({ matches }))
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
  stubMatchMedia(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LanguageChipBar', () => {
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

  it('collapsed mode renders only the selected chip plus the more trigger', () => {
    stubMatchMedia(false)
    renderBar({ value: 'en' })
    expect(chip('en')).toBeTruthy()
    expect(chip('auto')).toBeNull()
    expect(chip('ko')).toBeNull()
    expect(screen.getByTestId('lang-more-trigger')).toBeTruthy()
  })

  it('collapsed source bar offers auto in the more listbox when not selected', () => {
    stubMatchMedia(false)
    renderBar({ value: 'en' })
    fireEvent.mouseDown(screen.getByTestId('lang-more-trigger'))
    expect(
      document.querySelector(
        '[data-testid="select-option"][data-value="auto"]',
      ),
    ).toBeTruthy()
  })

  it('collapsed target bar never offers auto', () => {
    stubMatchMedia(false)
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
