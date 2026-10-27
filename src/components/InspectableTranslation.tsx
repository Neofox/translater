import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { isInspectTap, textOffsetAtPoint } from '../lib/phrasePointer'
import type { PointerPoint } from '../lib/phrasePointer'
import type { TextRange } from '../lib/learningRanges'

type Props = {
  text: string
  language: string
  disabled: boolean
  selectedChunk?: TextRange | null
  onInspect?: (offset: number) => void
  className?: string
  children?: ReactNode
  resetKey?: string
  actionLabel?: string
  expanded?: boolean
}

export default function InspectableTranslation({
  text,
  language,
  disabled,
  selectedChunk,
  onInspect,
  className = 'result-main',
  children,
  resetKey,
  actionLabel,
  expanded,
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
  return (
    <p
      ref={root}
      className={className}
      lang={language}
      data-testid="main-translation"
      data-inspectable={!disabled || undefined}
      onPointerDownCapture={(event) => {
        cancel()
        down.current =
          !disabled && event.button === 0 && !window.getSelection()?.toString()
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
          disabled ||
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
        // Let native double-click/long-press selection win before starting paid work.
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
          {text.slice(0, selected.start)}
          <mark className="learning-highlight" data-testid="selected-phrase">
            {text.slice(selected.start, selected.end)}
          </mark>
          {text.slice(selected.end)}
        </>
      ) : (
        text
      )}
      {children}
    </p>
  )
}
