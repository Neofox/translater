import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { isInspectTap, textOffsetAtPoint } from '../lib/phrasePointer'
import type { PointerPoint } from '../lib/phrasePointer'
import type { TextRange } from '../lib/learningRanges'

type Props = {
  text: string
  onReveal?: () => void
  wholeTextInteractive?: boolean
  language: string
  disabled: boolean
  selectedChunk?: TextRange | null
  onInspect?: (offset: number) => void
  className?: string
  children?: ReactNode
  resetKey?: string
  actionLabel?: string
  expanded?: boolean
  chunks?: TextRange[]
}

export default function InspectableTranslation({
  text,
  onReveal,
  wholeTextInteractive = false,
  language,
  disabled,
  selectedChunk,
  onInspect,
  className = 'result-main',
  children,
  resetKey,
  actionLabel,
  expanded,
  chunks = [],
}: Props) {
  const root = useRef<HTMLParagraphElement>(null)
  const down = useRef<PointerPoint | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useLayoutEffect(() => {
    cancel()
    down.current = null
    const reset = () => {
      cancel()
      down.current = null
    }
    window.addEventListener('pagehide', reset)
    return () => {
      reset()
      window.removeEventListener('pagehide', reset)
    }
  }, [text, disabled, resetKey])
  const selected = !disabled ? selectedChunk : null
  const interactive =
    !disabled && Boolean(wholeTextInteractive || actionLabel || chunks.length)
  const renderText = (from: number, to: number): ReactNode[] => {
    const parts: ReactNode[] = []
    let cursor = from
    if (!disabled)
      for (const chunk of chunks) {
        const start = Math.max(from, chunk.start)
        const end = Math.min(to, chunk.end)
        if (start >= end || start < cursor) continue
        parts.push(text.slice(cursor, start))
        parts.push(
          <span
            className="inspectable-phrase"
            data-testid="inspectable-phrase"
            data-start={start}
            key={start}
          >
            {text.slice(start, end)}
          </span>,
        )
        cursor = end
      }
    parts.push(text.slice(cursor, to))
    return parts
  }
  return (
    <p
      ref={root}
      className={className}
      lang={language}
      data-testid="main-translation"
      data-inspectable={interactive || undefined}
      tabIndex={wholeTextInteractive && interactive && !actionLabel ? 0 : -1}
      role={
        wholeTextInteractive && interactive && !actionLabel
          ? 'button'
          : undefined
      }
      aria-expanded={
        wholeTextInteractive && interactive && !actionLabel
          ? expanded
          : undefined
      }
      onKeyDown={(event) => {
        if (
          wholeTextInteractive &&
          interactive &&
          !actionLabel &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.preventDefault()
          onInspect?.(0)
        }
      }}
      onFocusCapture={onReveal}
      onPointerDownCapture={(event) => {
        onReveal?.()
        cancel()
        down.current =
          interactive &&
          event.button === 0 &&
          !window.getSelection()?.toString()
            ? { x: event.clientX, y: event.clientY, time: performance.now() }
            : null
      }}
      onPointerCancel={() => {
        down.current = null
        cancel()
      }}
      onDoubleClick={cancel}
      onPointerUp={(event) => {
        const start = down.current
        down.current = null
        if (
          !interactive ||
          !start ||
          !root.current ||
          !isInspectTap(
            start,
            { x: event.clientX, y: event.clientY, time: performance.now() },
            window.getSelection()?.toString() ?? '',
          )
        )
          return
        const offset = textOffsetAtPoint(
          root.current,
          event.clientX,
          event.clientY,
        )
        if (offset === null || offset >= text.length) return
        if (
          !wholeTextInteractive &&
          chunks.length &&
          !chunks.some((c) => offset >= c.start && offset < c.end)
        )
          return
        // Let native double-click/long-press selection win before inspecting.
        timer.current = setTimeout(() => {
          if (!window.getSelection()?.toString()) onInspect?.(offset)
        }, 400)
      }}
    >
      {actionLabel ? (
        <button
          type="button"
          className="word-details-trigger"
          data-testid="word-details-trigger"
          aria-label={actionLabel}
          aria-expanded={expanded}
          disabled={disabled}
          onClick={(event) => {
            // Pointer activation uses the selection-safe gesture handlers above.
            if (event.detail === 0 && !disabled) onInspect?.(0)
          }}
        >
          {text}
        </button>
      ) : selected ? (
        <>
          {renderText(0, selected.start)}
          <mark className="learning-highlight" data-testid="selected-phrase">
            {text.slice(selected.start, selected.end)}
          </mark>
          {renderText(selected.end, text.length)}
        </>
      ) : (
        renderText(0, text.length)
      )}
      {children}
    </p>
  )
}
