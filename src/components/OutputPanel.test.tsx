// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OutputPanel from './OutputPanel'
import type { LiveResult } from '../hooks/useTranslate'
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
  live: ((): LiveResult => ({
    intent: 'sentence',
    text: 'Hello there',
    done: false,
    requestSource: 'en',
    partial: { main: '안녕하세요', targetLang: 'ko' },
  }))(),
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
    text,
    resetKey,
  }: {
    disabled?: boolean
    language: string
    text: string
    resetKey?: string
  }) => (
    <button
      disabled={disabled}
      aria-label={`Listen in ${language}`}
      data-speech-text={text}
      data-reset-key={resetKey}
    />
  ),
}))

beforeEach(() => {
  fixture.context = ''
  fixture.input = 'Hello there'
  fixture.live = {
    intent: 'sentence',
    text: 'Hello there',
    requestSource: 'en',
    done: false,
    partial: { main: '안녕하세요', targetLang: 'ko' },
  }
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

it.each(['sentence', 'word'] as const)(
  'adds pronunciation for completed %s alternatives with the same stale-result guards',
  (intent) => {
    const common = {
      text: 'Hello there',
      requestSource: 'en' as const,
      done: false,
    }
    fixture.live =
      intent === 'sentence'
        ? {
            ...common,
            intent,
            partial: {
              targetLang: 'ko',
              main: '안녕하세요',
              alternatives: [{ text: '반가워요', note: 'A warm greeting.' }],
            },
          }
        : {
            ...common,
            intent,
            partial: {
              targetLang: 'ko',
              primaryTranslation: '안녕',
              alternativeTranslations: [
                {
                  text: '반가워요',
                  note: 'A warm greeting.',
                  register: ['polite'],
                },
              ],
            },
          }
    fixture.streaming = true
    const { rerender } = render(<OutputPanel />, { wrapper: UiLangProvider })
    expect(
      screen.queryAllByRole('button', { name: 'Listen in ko' }),
    ).toHaveLength(0)
    fixture.streaming = false
    fixture.live.done = true
    rerender(<OutputPanel />)
    const buttons = screen.getAllByRole<HTMLButtonElement>('button', {
      name: 'Listen in ko',
    })
    expect(buttons).toHaveLength(2)
    expect(buttons.map((button) => button.dataset.speechText)).toEqual([
      intent === 'sentence' ? '안녕하세요' : '안녕',
      '반가워요',
    ])
    expect(buttons.every((button) => !button.disabled)).toBe(true)
    const resetKey = buttons[1]!.dataset.resetKey
    fixture.context = 'A different reply'
    rerender(<OutputPanel />)
    expect(buttons[1]!.dataset.resetKey).not.toBe(resetKey)
    fixture.input = 'Another input'
    rerender(<OutputPanel />)
    expect(buttons.every((button) => button.disabled)).toBe(true)
    fixture.input = fixture.live.text
    fixture.isPending = true
    rerender(<OutputPanel />)
    expect(buttons.every((button) => button.disabled)).toBe(true)
  },
)
