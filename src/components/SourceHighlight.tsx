import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { TextRange } from '../lib/learningRanges'
import { isInspectTap } from '../lib/phrasePointer'
import type { PointerPoint } from '../lib/phrasePointer'

export default function SourceHighlight({
  text,
  spans,
  grammarHighlights = [],
  textareaRef,
  onInspect,
  inspectionKey,
}: {
  text: string
  spans: TextRange[]
  grammarHighlights?: TextRange[]
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onInspect?: (offset: number) => void
  inspectionKey?: string
}) {
  const mirrorRef = useRef<HTMLDivElement>(null)
  const inspect = useRef(onInspect)
  const enabled = Boolean(onInspect)
  useLayoutEffect(() => {
    inspect.current = onInspect
  }, [onInspect])
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || !enabled) return
    let down: (PointerPoint & { offset: number; pointerId: number }) | null =
      null
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      clearTimeout(timer)
      timer = undefined
      down = null
    }
    const selected = () =>
      textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
    const hit = (x: number, y: number) => {
      const bounds = textarea.getBoundingClientRect()
      if (
        x < bounds.left ||
        x > bounds.right ||
        y < bounds.top ||
        y > bounds.bottom
      )
        return null
      for (const span of mirrorRef.current?.querySelectorAll<HTMLElement>(
        '[data-source-start]',
      ) ?? []) {
        if (
          [...span.getClientRects()].some(
            (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
          )
        )
          return Number(span.dataset.sourceStart)
      }
      return null
    }
    const pointerDown = (event: PointerEvent) => {
      cancel()
      if (event.button !== 0 || !event.isPrimary || selected()) return
      const offset = hit(event.clientX, event.clientY)
      if (offset !== null)
        down = {
          x: event.clientX,
          y: event.clientY,
          time: performance.now(),
          offset,
          pointerId: event.pointerId,
        }
    }
    const pointerMove = (event: PointerEvent) => {
      if (
        down &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) >= 8
      )
        cancel()
    }
    const pointerUp = (event: PointerEvent) => {
      const start = down
      if (start && event.pointerId !== start.pointerId) return
      down = null
      if (
        !start ||
        event.button !== 0 ||
        !isInspectTap(
          start,
          { x: event.clientX, y: event.clientY, time: performance.now() },
          selected(),
        )
      )
        return
      timer = setTimeout(() => {
        timer = undefined
        if (
          textarea.isConnected &&
          document.activeElement === textarea &&
          textarea.value === text &&
          !selected()
        )
          inspect.current?.(start.offset)
      }, 400)
    }
    const select = () => {
      if (selected()) cancel()
    }
    textarea.addEventListener('pointerdown', pointerDown)
    window.addEventListener('pointermove', pointerMove)
    window.addEventListener('pointerup', pointerUp)
    textarea.addEventListener('select', select)
    const cancelEvents = [
      'pointercancel',
      'dblclick',
      'keydown',
      'input',
      'compositionstart',
      'scroll',
      'blur',
      'contextmenu',
      'dragstart',
    ] as const
    for (const event of cancelEvents) textarea.addEventListener(event, cancel)
    window.addEventListener('pagehide', cancel)
    return () => {
      cancel()
      textarea.removeEventListener('pointerdown', pointerDown)
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      textarea.removeEventListener('select', select)
      for (const event of cancelEvents)
        textarea.removeEventListener(event, cancel)
      window.removeEventListener('pagehide', cancel)
    }
  }, [text, textareaRef, enabled, inspectionKey])
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
  }, [text, spans, grammarHighlights, textareaRef])
  const renderPlain = (from: number, to: number) => {
    const parts = []
    let cursor = from
    for (const span of grammarHighlights) {
      const start = Math.max(from, span.start)
      const end = Math.min(to, span.end)
      if (start >= end || start < cursor) continue
      parts.push(
        text.slice(cursor, start),
        <span
          key={start}
          className="source-grammar"
          data-testid="source-grammar"
          data-source-start={start}
        >
          {text.slice(start, end)}
        </span>,
      )
      cursor = end
    }
    parts.push(text.slice(cursor, to))
    return parts
  }
  const parts = []
  let cursor = 0
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  for (const span of ordered) {
    if (span.start < cursor) continue
    parts.push(
      ...renderPlain(cursor, span.start),
      <mark key={`${span.start}:${span.end}`} className="learning-highlight">
        {text.slice(span.start, span.end)}
      </mark>,
    )
    cursor = span.end
  }
  parts.push(...renderPlain(cursor, text.length), '\u200b')
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
