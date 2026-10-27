import { LearningInput, LearningOutput } from '../server/learningTypes'
import type { LearningInputData, LearningResult } from '../server/learningTypes'

export type TextRange = { start: number; end: number }

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

/** Resolve counting mistakes only when the exact quotation is unambiguous. */
export function resolveLearningResult(
  input: LearningInputData,
  output: unknown,
): LearningResult {
  const data = LearningInput.parse(input)
  const result = LearningOutput.parse(output)
  const targetEdges = boundaries(data.translation)
  const sourceEdges = boundaries(data.text)
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
        data.translation,
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
            data.text,
            sourceEdges,
            0,
            data.text.length,
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
  const targetEdges = boundaries(data.translation)
  const sourceEdges = boundaries(data.text)
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
      !valid(chunk, data.translation, targetEdges)
    )
      throw new Error('Invalid translation span')
    for (const source of chunk.sourceSpans)
      if (!valid(source, data.text, sourceEdges))
        throw new Error('Invalid source span')
    uncovered += data.translation.slice(cursor, chunk.start)
    cursor = chunk.end
  }
  uncovered += data.translation.slice(cursor, data.sentenceEnd)
  return { ...result, partial: /[\p{L}\p{N}\p{M}\p{S}]/u.test(uncovered) }
}
