import { learningText, counterpartText } from './learningSide'
import {
  LearningInput,
  LearningOutput,
  LearningPhrase,
} from '../server/learningTypes'
import type { LearningInputData, LearningResult } from '../server/learningTypes'

export type TextRange = { start: number; end: number }
export const isLearningText = (text: string) => /[\p{L}\p{N}\p{S}]/u.test(text)

// Models sometimes "explain" native Korean words by glossing their Hangul
// syllables as characters. Keep a note only when every char is a real Han
// character and, for a Hangul word, there is exactly one per syllable.
export function isCharacterOrigin(note: {
  word: string
  chars: { char: string }[]
}): boolean {
  if (!note.chars.length) return false
  if (!note.chars.every(({ char }) => /^\p{Script=Han}$/u.test(char)))
    return false
  const hangul = [...note.word].filter((c) => /\p{Script=Hangul}/u.test(c))
  return !hangul.length || hangul.length === note.chars.length
}

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

/** Preserve ordered repeat disambiguation; salvage only unique, disjoint quotes
 * if a malformed ordering or overlap makes that full sequence impossible. */
function phraseRanges(
  text: string,
  phrases: { text: string }[],
  edges: Set<number>,
) {
  const earliest: number[] = []
  const latest: number[] = []
  let cursor = 0
  let ordered = true
  for (const phrase of phrases) {
    const start = text.indexOf(phrase.text, cursor)
    if (start < 0) {
      ordered = false
      break
    }
    earliest.push(start)
    cursor = start + phrase.text.length
  }
  if (ordered) {
    cursor = text.length
    for (let i = phrases.length - 1; i >= 0; i--) {
      const phrase = phrases[i]!
      const start = text.lastIndexOf(phrase.text, cursor - phrase.text.length)
      if (start < 0) {
        ordered = false
        break
      }
      latest[i] = start
      cursor = start
    }
  }
  const candidates = phrases
    .flatMap((phrase, index) => {
      const start = ordered ? earliest[index]! : text.indexOf(phrase.text)
      const last = ordered ? latest[index]! : text.lastIndexOf(phrase.text)
      const end = start + phrase.text.length
      return start >= 0 && start === last && edges.has(start) && edges.has(end)
        ? [{ index, start, end }]
        : []
    })
    .sort((a, b) => a.start - b.start || a.end - b.end)
  // Reject both members of an overlap instead of choosing one arbitrarily.
  return candidates.filter(
    (span, i) =>
      !candidates.some(
        (other, j) =>
          i !== j && span.start < other.end && other.start < span.end,
      ),
  )
}

/** Resolve inline details and selective grammar quotations without model-counted offsets. */
export function prepareLearningResult(
  source: string,
  target: string,
  value: unknown,
): LearningResult | null {
  // Page-memory compatibility only. The generated schema still requires every field.
  const parsed = LearningPhrase.partial({
    baseForm: true,
    literalMeaning: true,
    naturalMeaning: true,
    grammar: true,
    omissions: true,
    grammarHighlights: true,
    usageNote: true,
    characters: true,
  })
    .array()
    .max(64)
    .safeParse(value)
  const data = parsed.success
    ? parsed.data.map((p) => ({
        ...p,
        baseForm: p.baseForm ?? '',
        literalMeaning: p.literalMeaning ?? '',
        naturalMeaning: p.naturalMeaning ?? '',
        grammar: p.grammar ?? '',
        omissions: p.omissions ?? '',
        grammarHighlights: p.grammarHighlights ?? [],
        usageNote: p.usageNote ?? '',
        characters: p.characters ?? [],
      }))
    : null
  if (!data) return null
  const phrases = data.filter(
    (p) => isLearningText(p.text) && target.includes(p.text),
  )
  if (!phrases.length) return null
  const edges = boundaries(target)
  const sourceEdges = boundaries(source)
  const chunks = phraseRanges(target, phrases, edges).flatMap(
    ({ index, start, end }) => {
      const phrase = phrases[index]!
      return [
        {
          start,
          end,
          text: phrase.text,
          gloss: phrase.gloss,
          baseForm: phrase.baseForm,
          literalMeaning: phrase.literalMeaning,
          naturalMeaning: phrase.naturalMeaning,
          grammar: phrase.grammar,
          omissions: phrase.omissions,
          usageNote: phrase.usageNote,
          characters: phrase.characters.filter(
            (note) =>
              phrase.text.includes(note.word) && isCharacterOrigin(note),
          ),
          grammarHighlights: (phrase.grammar.trim()
            ? phrase.grammarHighlights
            : []
          )
            .flatMap((text) => {
              const from = phrase.text.indexOf(text)
              const to = from + text.length
              return isLearningText(text) &&
                from >= 0 &&
                from === phrase.text.lastIndexOf(text) &&
                edges.has(start + from) &&
                edges.has(start + to)
                ? [{ start: start + from, end: start + to }]
                : []
            })
            .sort((a, b) => a.start - b.start || b.end - a.end)
            .reduce<TextRange[]>((ranges, span) => {
              if (
                !ranges.length ||
                span.start >= ranges[ranges.length - 1]!.end
              )
                ranges.push(span)
              return ranges
            }, []),
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
    },
  )
  if (!chunks.length) return null
  let uncovered = ''
  let cursor = 0
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
