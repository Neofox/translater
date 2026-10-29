// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import WordSourceMeta from './WordSourceMeta'
import { UiLangProvider } from '../hooks/useUiLang'

afterEach(cleanup)
it('puts grammar, vocabulary nuance and characters inside the dictionary entry', () => {
  render(
    <WordSourceMeta
      result={{
        grammar: '안녕하세요 is a polite set expression.',
        notes: 'Use it when greeting someone you do not know well.',
        characters: [
          {
            word: '안녕',
            chars: [
              { char: '安', meaning: 'peace' },
              { char: '寧', meaning: 'calm' },
            ],
          },
        ],
      }}
    />,
    { wrapper: UiLangProvider },
  )
  expect(
    screen.getByText('안녕하세요 is a polite set expression.'),
  ).toBeTruthy()
  expect(
    screen.getByText('Use it when greeting someone you do not know well.'),
  ).toBeTruthy()
  expect(screen.getByText('안녕')).toBeTruthy()
  expect(screen.getByText(/peace/)).toBeTruthy()
  expect(screen.queryByText('Learning tips')).toBeNull()
})
