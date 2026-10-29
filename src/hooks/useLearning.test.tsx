// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLearning } from './useLearning'
import type { LearningResult } from '../server/learningTypes'

const network = vi.fn()
beforeEach(() => vi.stubGlobal('fetch', network))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
const snapshot = {
  text: 'Hello',
  translation: '안녕',
  sentenceStart: 0,
  sentenceEnd: 2,
  source: 'en',
  target: 'ko',
  mode: 'casual' as const,
  uiLang: 'en' as const,
  context: '',
}
const output: LearningResult = {
  wordOrder: '',
  partial: false,
  chunks: [
    {
      start: 0,
      end: 2,
      text: '안녕',
      sourceSpans: [],
      gloss: 'hello',
      baseForm: '안녕',
      literalMeaning: 'peace',
      naturalMeaning: 'hello',
      grammar: 'An informal greeting.',
      omissions: '',
      grammarHighlights: [],
    },
  ],
}
const props = {
  snapshot,
  prepared: output,
  requestKey: 'current',
  enabled: true,
}
it('reveals complete initial-response details immediately with no enrichment action or network', () => {
  const { result } = renderHook(() => useLearning(props), {
    wrapper: StrictMode,
  })
  expect(result.current.result?.chunks[0]?.grammar).toBe(
    'An informal greeting.',
  )
  act(() => result.current.openAt(1))
  expect(result.current.selectedChunk?.baseForm).toBe('안녕')
  expect(result.current.status).toBe('ready')
  expect(result.current).not.toHaveProperty('loadDetails')
  expect(result.current).not.toHaveProperty('retry')
  expect(network).not.toHaveBeenCalled()
})
it('reopening and changing phrase selection stays entirely local', () => {
  const { result } = renderHook(() => useLearning(props))
  act(() => result.current.openAt(0))
  act(() => result.current.selectChunk(null))
  expect(result.current.selectedChunk).toBeNull()
  act(() => result.current.selectChunk(0))
  expect(result.current.selectedChunk?.literalMeaning).toBe('peace')
  act(() => result.current.close())
  expect(result.current.isOpen).toBe(false)
  act(() => result.current.openAt(0))
  expect(result.current.selectedChunk?.grammar).toBe('An informal greeting.')
  expect(network).not.toHaveBeenCalled()
})
it('does not fetch missing legacy phrase data', () => {
  const { result } = renderHook(() => useLearning({ ...props, prepared: null }))
  act(() => result.current.openAt())
  expect(result.current.isOpen).toBe(false)
  expect(result.current.result).toBeNull()
  expect(network).not.toHaveBeenCalled()
})
it('clears open selection on request changes even when wording is identical', () => {
  const { result, rerender } = renderHook((p) => useLearning(p), {
    initialProps: props,
  })
  act(() => result.current.openAt(0))
  rerender({ ...props, requestKey: 'new settings' })
  expect(result.current.isOpen).toBe(false)
  expect(result.current.selectedChunk).toBeNull()
})
it('invalidates immediately on edits, pending settings, errors or Clear', () => {
  const { result, rerender } = renderHook((p) => useLearning(p), {
    initialProps: props,
  })
  act(() => result.current.openAt(0))
  rerender({ ...props, enabled: false })
  expect(result.current.isOpen).toBe(false)
  expect(result.current.selectedChunk).toBeNull()
  expect(result.current.result).toBeNull()
})
it('closes on pagehide without persisting source or analysis', () => {
  const { result } = renderHook(() => useLearning(props))
  act(() => result.current.openAt(0))
  act(() => window.dispatchEvent(new Event('pagehide')))
  expect(result.current.isOpen).toBe(false)
  expect(result.current.selectedChunk).toBeNull()
  expect(network).not.toHaveBeenCalled()
})
it('segments the non-fluent original source and opens its prepared details', () => {
  const reading = {
    ...snapshot,
    text: '안녕',
    translation: 'Hello',
    source: 'ko',
    target: 'en',
    side: 'source' as const,
  }
  const { result } = renderHook(() =>
    useLearning({ ...props, snapshot: reading }),
  )
  expect(result.current.result?.chunks[0]?.text).toBe('안녕')
  act(() => result.current.openAt(1))
  expect(result.current.selectedChunk?.text).toBe('안녕')
  expect(network).not.toHaveBeenCalled()
})
it('shows the whole multi-sentence message and selects phrases by global offset without pagination', () => {
  const translation = '안녕. 다시 왔어.'
  const prepared: LearningResult = {
    ...output,
    chunks: [
      output.chunks[0]!,
      {
        ...output.chunks[0]!,
        start: 4,
        end: 9,
        text: '다시 왔어',
        baseForm: '오다',
      },
    ],
  }
  const { result } = renderHook(() =>
    useLearning({
      ...props,
      prepared,
      snapshot: { ...snapshot, translation, sentenceEnd: translation.length },
    }),
  )
  expect(result.current.result?.chunks).toHaveLength(2)
  expect(result.current).not.toHaveProperty('selectSentence')
  act(() => result.current.openAt(7))
  expect(result.current.selectedChunk?.text).toBe('다시 왔어')
  act(() => result.current.selectChunk(0))
  expect(result.current.selectedChunk?.text).toBe('안녕')
  expect(result.current.result?.chunks).toHaveLength(2)
  expect(network).not.toHaveBeenCalled()
})
