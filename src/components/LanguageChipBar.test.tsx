// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import LanguageChipBar from './LanguageChipBar'
import { UiLangProvider } from '../hooks/useUiLang'

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

beforeEach(() => window.localStorage.clear())
afterEach(() => cleanup())

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
})
