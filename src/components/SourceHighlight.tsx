import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { TextRange } from '../lib/learningRanges'

export default function SourceHighlight({
  text,
  spans,
  textareaRef,
}: {
  text: string
  spans: TextRange[]
  textareaRef: RefObject<HTMLTextAreaElement | null>
}) {
  const mirrorRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return
    const sync = () => {
      const style = getComputedStyle(textarea)
      for (const property of [
        'font',
        'letter-spacing',
        'line-height',
        'padding',
        'border-width',
        'box-sizing',
        'text-align',
        'word-break',
        'overflow-wrap',
        'tab-size',
      ])
        mirror.style.setProperty(property, style.getPropertyValue(property))
      mirror.scrollTop = textarea.scrollTop
      mirror.scrollLeft = textarea.scrollLeft
    }
    sync()
    textarea.addEventListener('scroll', sync, { passive: true })
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    observer?.observe(textarea)
    return () => {
      observer?.disconnect()
      textarea.removeEventListener('scroll', sync)
    }
  }, [text, spans, textareaRef])
  const parts = []
  let cursor = 0
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  for (const span of ordered) {
    if (span.start < cursor) continue
    parts.push(
      text.slice(cursor, span.start),
      <mark key={`${span.start}:${span.end}`} className="learning-highlight">
        {text.slice(span.start, span.end)}
      </mark>,
    )
    cursor = span.end
  }
  parts.push(text.slice(cursor), '\u200b')
  return (
    <div
      ref={mirrorRef}
      className="source-highlight"
      aria-hidden="true"
      data-testid="source-highlight"
    >
      {parts}
    </div>
  )
}
