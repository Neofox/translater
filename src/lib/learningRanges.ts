import { learningText, counterpartText } from './learningSide'
import {
  LearningInput,
  LearningOutput,
  LearningPhrases,
} from '../server/learningTypes'
import type { LearningInputData, LearningResult } from '../server/learningTypes'

export type TextRange = { start: number; end: number }
export const isLearningText = (text: string) => /[\p{L}\p{N}\p{S}]/u.test(text)

export function sentenceRanges(text: string, language: string): TextRange[] {
  if (!text) return []
  try {
    return Array.from(
      new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text),
      (part) => ({ start: part.index, end: part.index + part.segment.length }),
    )
  } catch {
    return [{ start: 0, end: text.length }]
  }
}

function boundaries(text: string) {
  const points = new Set([text.length])
  for (const part of new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  }).segment(text))
    points.add(part.index)
  return points
}

/** Resolve the translation's small phrase map without asking the model to count. */
export function prepareLearningResult(
  source: string,
  target: string,
  value: unknown,
): LearningResult | null {
  const parsed = LearningPhrases.safeParse(value)
  if (!parsed.success) return null
  const phrases = parsed.data.filter(
    (p) => isLearningText(p.text) && target.includes(p.text),
  )
  if (!phrases.length) return null
  const edges = boundaries(target)
  const sourceEdges = boundaries(source)
  const earliest: number[] = []
  const latest: number[] = []
  let cursor = 0
  for (const phrase of phrases) {
    const start = target.indexOf(phrase.text, cursor)
    if (start < 0) return null
    earliest.push(start)
    cursor = start + phrase.text.length
  }
  cursor = target.length
  for (let i = phrases.length - 1; i >= 0; i--) {
    const phrase = phrases[i]!
    const start = target.lastIndexOf(phrase.text, cursor - phrase.text.length)
    if (start < 0) return null
    latest[i] = start
    cursor = start
  }
  const chunks = phrases.flatMap((phrase, i) => {
    const start = earliest[i]!
    const end = start + phrase.text.length
    if (start !== latest[i] || !edges.has(start) || !edges.has(end)) return []
    return [
      {
        start,
        end,
        text: phrase.text,
        gloss: phrase.gloss,
        baseForm: '',
        literalMeaning: '',
        naturalMeaning: '',
        grammar: '',
        omissions: '',
        sourceSpans: phrase.sourceTexts.flatMap((text) => {
          const from = source.indexOf(text)
          const to = from + text.length
          return from >= 0 &&
            from === source.lastIndexOf(text) &&
            sourceEdges.has(from) &&
            sourceEdges.has(to)
            ? [{ start: from, end: to, text }]
            : []
        }),
      },
    ]
  })
  if (!chunks.length) return null
  let uncovered = ''
  cursor = 0
  for (const chunk of chunks) {
    uncovered += target.slice(cursor, chunk.start)
    cursor = chunk.end
  }
  uncovered += target.slice(cursor)
  return { chunks, wordOrder: '', partial: isLearningText(uncovered) }
}

/** Resolve counting mistakes only when the exact quotation is unambiguous. */
export function resolveLearningResult(
  input: LearningInputData,
  output: unknown,
): LearningResult {
  const data = LearningInput.parse(input)
  const result = LearningOutput.parse(output)
  const analysed = learningText(data)
  const counterpart = counterpartText(data)
  const targetEdges = boundaries(analysed)
  const sourceEdges = boundaries(counterpart)
  const resolve = (
    span: TextRange & { text: string },
    text: string,
    edges: Set<number>,
    from: number,
    to: number,
  ) => {
    if (
      span.start >= from &&
      span.end <= to &&
      span.start < span.end &&
      edges.has(span.start) &&
      edges.has(span.end) &&
      text.slice(span.start, span.end) === span.text
    )
      return span
    const start = text.indexOf(span.text, from)
    const end = start + span.text.length
    const next = text.indexOf(span.text, start + 1)
    if (
      start < from ||
      end > to ||
      !edges.has(start) ||
      !edges.has(end) ||
      (next !== -1 && next + span.text.length <= to)
    )
      return null
    return { ...span, start, end }
  }
  return validateLearningResult(data, {
    ...result,
    chunks: result.chunks.map((chunk) => {
      const target = resolve(
        chunk,
        analysed,
        targetEdges,
        data.sentenceStart,
        data.sentenceEnd,
      )
      if (!target) throw new Error('Unresolved translation quote')
      return {
        ...chunk,
        ...target,
        sourceSpans: chunk.sourceSpans.flatMap((span) => {
          const source = resolve(
            span,
            counterpart,
            sourceEdges,
            0,
            counterpart.length,
          )
          return source ? [source] : []
        }),
      }
    }),
  })
}

export function validateLearningResult(
  input: LearningInputData,
  output: unknown,
): LearningResult {
  const data = LearningInput.parse(input)
  const result = LearningOutput.parse(output)
  const analysed = learningText(data)
  const counterpart = counterpartText(data)
  const targetEdges = boundaries(analysed)
  const sourceEdges = boundaries(counterpart)
  if (
    !targetEdges.has(data.sentenceStart) ||
    !targetEdges.has(data.sentenceEnd)
  )
    throw new Error('Invalid sentence boundary')
  const valid = (
    span: TextRange & { text: string },
    text: string,
    edges: Set<number>,
  ) =>
    span.start < span.end &&
    edges.has(span.start) &&
    edges.has(span.end) &&
    text.slice(span.start, span.end) === span.text
  let cursor = data.sentenceStart
  let uncovered = ''
  for (const chunk of result.chunks) {
    if (
      chunk.start < cursor ||
      chunk.end > data.sentenceEnd ||
      !valid(chunk, analysed, targetEdges)
    )
      throw new Error('Invalid translation span')
    for (const source of chunk.sourceSpans)
      if (!valid(source, counterpart, sourceEdges))
        throw new Error('Invalid source span')
    uncovered += analysed.slice(cursor, chunk.start)
    cursor = chunk.end
  }
  uncovered += analysed.slice(cursor, data.sentenceEnd)
  return { ...result, partial: /[\p{L}\p{N}\p{M}\p{S}]/u.test(uncovered) }
}
