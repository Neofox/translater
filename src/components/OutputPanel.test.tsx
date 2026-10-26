// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OutputPanel from './OutputPanel'
import { translationRequestKey } from '../lib/translationRequestKey'
import type { LiveResult } from '../hooks/useTranslate'
import { UiLangProvider } from '../hooks/useUiLang'
import {
  COMPACT_LAYOUT,
  WorkspaceLayoutContext,
} from '../context/WorkspaceLayoutContext'

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
  setTarget: vi.fn(),
  setSource: vi.fn(),
  setInput: vi.fn(),
  run: vi.fn(),
  detected: 'en',
}))

vi.mock('../context/TranslatorContext', () => ({
  useTranslatorContext: () => fixture,
}))
vi.mock('./LanguageChipBar', () => ({ default: () => null }))
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
  fixture.source = 'en'
  fixture.target = 'ko'
  fixture.mode = 'casual'
  fixture.refinements = []
  fixture.context = ''
  fixture.input = 'Hello there'
  fixture.live = {
    intent: 'sentence',
    text: 'Hello there',
    requestSource: 'en',
    done: false,
    partial: { main: '안녕하세요', targetLang: 'ko' },
  }
  fixture.live.requestKey = translationRequestKey({
    ...fixture,
    text: fixture.input,
    uiLang: 'en',
  })
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

it('disables Copy until the current translation is complete', () => {
  const { rerender } = render(<OutputPanel />, { wrapper: UiLangProvider })
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Copy' }).disabled,
  ).toBe(true)
  fixture.live.done = true
  rerender(<OutputPanel />)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Copy' }).disabled,
  ).toBe(false)
  fixture.input = 'An edited source'
  rerender(<OutputPanel />)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Copy' }).disabled,
  ).toBe(true)
  fixture.input = fixture.live.text
  fixture.isPending = true
  rerender(<OutputPanel />)
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Copy' }).disabled,
  ).toBe(true)
})

it('does not offer a successful Copy action for a failed result', () => {
  fixture.live.done = true
  fixture.error = { kind: 'server', message: 'Unavailable' }
  render(<OutputPanel />, { wrapper: UiLangProvider })
  expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
})

it('keeps desktop explanation and learning content open with static headings', () => {
  fixture.live.done = true
  fixture.live.partial = {
    ...fixture.live.partial,
    rationale: 'The wording avoids a literal idiom.',
    formalityNote: 'A polite ending.',
    learningTips: { grammar: 'A useful ending.', vocab: '', characters: [] },
  }
  render(
    <WorkspaceLayoutContext.Provider
      value={{ ...COMPACT_LAYOUT, desktop: true }}
    >
      <OutputPanel />
    </WorkspaceLayoutContext.Provider>,
    { wrapper: UiLangProvider },
  )
  expect(
    screen.getByRole('heading', { name: /^Why this wording/ }),
  ).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Learning tips' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Why this wording/ })).toBeNull()
  expect(screen.getByText('A useful ending.').closest('[hidden]')).toBeNull()
})

it('tucks compact wording notes behind a keyboard-accessible disclosure', () => {
  fixture.live.done = true
  fixture.live.partial = {
    ...fixture.live.partial,
    rationale: 'An idiomatic expression.',
    formalityNote: 'A polite ending.',
  }
  render(<OutputPanel />, { wrapper: UiLangProvider })
  const toggle = screen.getByRole('button', { name: /^Why this wording/ })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText('A polite ending.').closest('[hidden]')).toBeTruthy()
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('A polite ending.').closest('[hidden]')).toBeNull()
})

it.each(['sentence', 'word'] as const)(
  'adds pronunciation for completed %s alternatives with the same stale-result guards',
  (intent) => {
    const common = {
      text: 'Hello there',
      requestSource: 'en' as const,
      done: false,
      requestKey: translationRequestKey({
        ...fixture,
        text: fixture.input,
        uiLang: 'en',
      }),
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
    fireEvent.click(
      screen.getByRole('button', {
        name:
          intent === 'sentence' ? 'Alternatives' : 'Alternative translations',
      }),
    )
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

it.each(['target', 'source', 'mode', 'context', 'refinements'] as const)(
  'disables completed actions during the %s settings debounce',
  (setting) => {
    fixture.live.done = true
    fixture.live.requestKey = translationRequestKey({
      ...fixture,
      text: fixture.input,
      uiLang: 'en',
    })
    const { rerender } = render(<OutputPanel />, { wrapper: UiLangProvider })
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Copy' }).disabled,
    ).toBe(false)
    if (setting === 'refinements') fixture.refinements = ['make it softer']
    else
      fixture[setting] =
        setting === 'target'
          ? 'ja'
          : setting === 'source'
            ? 'auto'
            : setting === 'mode'
              ? 'friends'
              : 'A new context'
    rerender(<OutputPanel />)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Copy' }).disabled,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Listen in ko' })
        .disabled,
    ).toBe(true)
  },
)

it.each(['sentence', 'word'] as const)(
  'disables every %s alternative Copy while stale, pending or streaming',
  (intent) => {
    const common = {
      text: fixture.input,
      requestSource: 'en' as const,
      done: true,
      requestKey: translationRequestKey({
        ...fixture,
        text: fixture.input,
        uiLang: 'en',
      }),
    }
    fixture.live =
      intent === 'sentence'
        ? {
            ...common,
            intent,
            partial: {
              main: '안녕하세요',
              alternatives: [
                { text: '반가워요', note: '' },
                { text: '안녕', note: '' },
              ],
            },
          }
        : {
            ...common,
            intent,
            partial: {
              primaryTranslation: '안녕하세요',
              alternativeTranslations: [
                { text: '반가워요', note: '', register: [] },
                { text: '안녕', note: '', register: [] },
              ],
            },
          }
    const { rerender } = render(<OutputPanel />, { wrapper: UiLangProvider })
    fireEvent.click(
      screen.getByRole('button', {
        name:
          intent === 'sentence' ? 'Alternatives' : 'Alternative translations',
      }),
    )
    const copies = () =>
      screen.getAllByRole<HTMLButtonElement>('button', { name: 'Copy' })
    expect(copies()).toHaveLength(3)
    fixture.input = 'Edited draft'
    rerender(<OutputPanel />)
    expect(copies().every((button) => button.disabled)).toBe(true)
    fixture.input = fixture.live.text
    fixture.isPending = true
    rerender(<OutputPanel />)
    expect(copies().every((button) => button.disabled)).toBe(true)
    fixture.live.done = false
    fixture.streaming = true
    rerender(<OutputPanel />)
    expect(copies()).toHaveLength(2)
    expect(copies().every((button) => button.disabled)).toBe(true)
  },
)

it('swaps a completed result back into the source without losing its language', () => {
  fixture.live.done = true
  render(<OutputPanel />, { wrapper: UiLangProvider })
  fireEvent.click(screen.getByRole('button', { name: 'Swap languages' }))
  expect(fixture.setInput).toHaveBeenCalledWith('안녕하세요')
  expect(fixture.setSource).toHaveBeenCalledWith('auto')
  expect(fixture.setTarget).toHaveBeenCalledWith('en')
})

it('offers an explicit retry for a failed translation', () => {
  fixture.error = { kind: 'server', message: 'Unavailable' }
  render(<OutputPanel />, { wrapper: UiLangProvider })
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(fixture.run).toHaveBeenCalledWith(undefined, 'force')
})
