import { useLayoutEffect, useRef, useState } from 'react'
import { useFoldLayout } from './useFoldLayout'
import { COMPACT_LAYOUT } from '../context/WorkspaceLayoutContext'
import type { WorkspaceLayout } from '../context/WorkspaceLayoutContext'

export function useWorkspaceLayout() {
  const panelsRef = useFoldLayout()
  const [layout, setLayout] = useState(COMPACT_LAYOUT)
  const previous = useRef(layout)
  const restoreFocus = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const panels = panelsRef.current
    if (!panels) return
    const shell = panels.closest<HTMLElement>('.app-shell')
    const book = window.matchMedia(
      '(device-posture: folded) and (horizontal-viewport-segments: 2)',
    )
    const laptop = window.matchMedia(
      '(device-posture: folded) and (vertical-viewport-segments: 2)',
    )
    const viewport = window.visualViewport
    const touch = window.matchMedia('(any-pointer: coarse)')
    let natural = { width: window.innerWidth, height: window.innerHeight }
    const measure = () => {
      const zoomed = Math.abs((viewport?.scale || 1) - 1) > 0.01
      const visibleHeight = zoomed
        ? window.innerHeight
        : viewport?.height || window.innerHeight
      const outerWidth = panels.clientWidth || window.innerWidth
      if (Math.abs(outerWidth - natural.width) > 1)
        natural = {
          width: outerWidth,
          height: Math.max(window.innerHeight, visibleHeight),
        }
      const focused = document.activeElement
      const editing =
        focused instanceof HTMLElement &&
        panels.contains(focused) &&
        focused.matches('textarea, input, [contenteditable="true"]')
      const keyboard =
        !zoomed &&
        (previous.current.keyboard ||
          (editing &&
            (touch.matches || visibleHeight < window.innerHeight - 100))) &&
        natural.height - visibleHeight > Math.max(100, natural.height * 0.2)
      // Keyboard animations arrive as many small resizes. Keep the original
      // height throughout editing instead of ratcheting it down at each frame.
      const screenResize = !touch.matches && visibleHeight >= window.innerHeight
      if (!keyboard && !zoomed && (!editing || screenResize))
        natural.height = visibleHeight
      shell?.style.setProperty('--app-height', `${visibleHeight}px`)
      // Safari may pan its visual viewport independently of the layout viewport.
      // Clamp a stale offset back to zero after the keyboard has been dismissed.
      const top = zoomed
        ? 0
        : Math.max(
            0,
            Math.min(
              viewport?.offsetTop || 0,
              Math.max(window.innerHeight, natural.height) - visibleHeight,
            ),
          )
      shell?.style.setProperty('--app-top', `${top}px`)
      const safeArea = getComputedStyle(shell ?? panels)
      const sideInsets =
        (parseFloat(safeArea.getPropertyValue('--safe-area-left')) || 0) +
        (parseFloat(safeArea.getPropertyValue('--safe-area-right')) || 0)
      const width = Math.max(0, outerWidth - sideInsets)
      const height = panels.clientHeight || visibleHeight
      panels.style.setProperty('--workspace-height', `${height}px`)
      const mode: WorkspaceLayout['mode'] = laptop.matches
        ? 'laptop'
        : book.matches
          ? 'book'
          : width >= 1100
            ? 'workspace'
            : width >= 560 && width > natural.height
              ? 'split'
              : 'stack'
      const resultFirst = mode === 'laptop' || mode === 'stack'
      const next = {
        mode,
        resultFirst,
        desktop: mode === 'workspace',
        short: visibleHeight < 460,
        tight: visibleHeight < 360,
        keyboard,
      }
      if (
        Object.keys(next).every(
          (key) =>
            next[key as keyof WorkspaceLayout] ===
            previous.current[key as keyof WorkspaceLayout],
        )
      )
        return
      if (focused instanceof HTMLElement && panels.contains(focused))
        restoreFocus.current = focused
      previous.current = next
      setLayout(next)
    }
    let frame = 0
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(measure)
          })
    observer?.observe(panels)
    window.addEventListener('resize', measure)
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    panels.addEventListener('focusin', measure)
    panels.addEventListener('focusout', measure)
    book.addEventListener('change', measure)
    laptop.addEventListener('change', measure)
    measure()
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
      panels.removeEventListener('focusin', measure)
      panels.removeEventListener('focusout', measure)
      book.removeEventListener('change', measure)
      laptop.removeEventListener('change', measure)
      shell?.style.removeProperty('--app-height')
      shell?.style.removeProperty('--app-top')
    }
  }, [panelsRef])

  useLayoutEffect(() => {
    const element = restoreFocus.current
    if (element?.isConnected && document.activeElement === document.body)
      element.focus({ preventScroll: true })
    restoreFocus.current = null
  }, [layout])

  useLayoutEffect(() => {
    if (layout.keyboard) {
      const result = panelsRef.current?.querySelector('.result-scroll')
      if (result) result.scrollTop = 0
    }
  }, [layout.keyboard, panelsRef])

  return { panelsRef, layout }
}
