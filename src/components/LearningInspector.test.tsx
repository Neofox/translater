// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LearningInspector from './LearningInspector'
import { UiLangProvider } from '../hooks/useUiLang'

const fixture = vi.hoisted(() => ({
  // This deliberately partial hook fixture exercises the inspector in isolation.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  learning: null as unknown,
  translator: {
    live: {
      intent: 'sentence',
      partial: {
        learningTips: { grammar: 'Useful ending', vocab: '', characters: [] },
      },
    },
    streaming: false,
    error: null,
    lookupWord: vi.fn(),
  },
}))
vi.mock('../context/LearningContext', () => ({
  useLearningContext: () => fixture.learning,
}))
vi.mock('../context/TranslatorContext', () => ({
  useTranslatorContext: () => fixture.translator,
}))
afterEach(cleanup)
it('shows one chunk overview and opens its detail without changing input', () => {
  const selectChunk = vi.fn()
  fixture.learning = {
    status: 'ready',
    selectedChunk: null,
    ranges: [{ start: 0, end: 2 }],
    selectedSentence: 0,
    selectChunk,
    result: {
      wordOrder: 'Thanks goes last',
      partial: false,
      chunks: [{ text: '안녕', gloss: 'hello' }],
    },
  }
  render(<LearningInspector />, { wrapper: UiLangProvider })
  fireEvent.click(screen.getByRole('button', { name: '안녕 hello' }))
  expect(selectChunk).toHaveBeenCalledWith(0)
  expect(screen.getAllByText('Useful ending')).toHaveLength(1)
})
it('renders useful phrase facts and returns to the whole sentence', () => {
  const selectChunk = vi.fn()
  fixture.learning = {
    status: 'ready',
    selectedChunk: {
      text: '도와줘서',
      gloss: 'for helping me',
      baseForm: '도와주다',
      grammar: '-어서 gives the reason',
      literalMeaning: '',
      naturalMeaning: '',
      omissions: '',
    },
    selectChunk,
    selectedSentence: 0,
    ranges: [{ start: 0, end: 13 }],
  }
  render(<LearningInspector />, { wrapper: UiLangProvider })
  expect(screen.getByText('도와주다')).toBeTruthy()
  expect(screen.queryByText('Literal')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Whole sentence' }))
  expect(selectChunk).toHaveBeenCalledWith(null)
})
it('contains learning failure without exposing provider text and offers explicit retry', () => {
  const retry = vi.fn()
  fixture.learning = {
    status: 'error',
    error: 'learningFailed',
    retry,
    ranges: [],
    selectedSentence: 0,
  }
  render(<LearningInspector />, { wrapper: UiLangProvider })
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
})
it('omits punctuation-only rows while preserving the selected phrase index', () => {
  const selectChunk = vi.fn()
  fixture.learning = {
    status: 'ready',
    selectedChunk: null,
    ranges: [{ start: 0, end: 14 }],
    selectedSentence: 0,
    selectChunk,
    result: {
      wordOrder: '',
      partial: false,
      chunks: [
        { text: '안녕하세요', gloss: 'hello' },
        { text: ',', gloss: '' },
        { text: '잘 지내세요?', gloss: 'how are you' },
      ],
    },
  }
  render(<LearningInspector />, { wrapper: UiLangProvider })
  expect(screen.getAllByTestId('learning-chunk')).toHaveLength(2)
  fireEvent.click(
    screen.getByRole('button', { name: '잘 지내세요? how are you' }),
  )
  expect(selectChunk).toHaveBeenCalledWith(2)
})
