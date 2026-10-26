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
    const measure = () => {
      const visibleHeight = viewport?.height || window.innerHeight
      shell?.style.setProperty('--app-height', `${visibleHeight}px`)
      const safeArea = getComputedStyle(shell ?? panels)
      const sideInsets =
        (parseFloat(safeArea.getPropertyValue('--safe-area-left')) || 0) +
        (parseFloat(safeArea.getPropertyValue('--safe-area-right')) || 0)
      const width = Math.max(
        0,
        (panels.clientWidth || window.innerWidth) - sideInsets,
      )
      const height = panels.clientHeight || visibleHeight
      panels.style.setProperty('--workspace-height', `${height}px`)
      const mode: WorkspaceLayout['mode'] = laptop.matches
        ? 'laptop'
        : book.matches
          ? 'book'
          : width >= 520 && width > visibleHeight && visibleHeight < 360
            ? 'split'
            : 'stack'
      const resultFirst =
        mode === 'laptop' ||
        (mode !== 'book' && (width < 640 || visibleHeight < 480))
      const next = {
        mode,
        resultFirst,
        desktop:
          mode === 'stack' &&
          !resultFirst &&
          width >= 700 &&
          visibleHeight >= 480,
        short: visibleHeight < 460,
        tight: visibleHeight < 360,
      }
      if (
        Object.keys(next).every(
          (key) =>
            next[key as keyof WorkspaceLayout] ===
            previous.current[key as keyof WorkspaceLayout],
        )
      )
        return
      const focused = document.activeElement
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
    book.addEventListener('change', measure)
    laptop.addEventListener('change', measure)
    measure()
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      viewport?.removeEventListener('resize', measure)
      book.removeEventListener('change', measure)
      laptop.removeEventListener('change', measure)
      shell?.style.removeProperty('--app-height')
    }
  }, [panelsRef])

  useLayoutEffect(() => {
    const element = restoreFocus.current
    if (element?.isConnected && document.activeElement === document.body)
      element.focus({ preventScroll: true })
    restoreFocus.current = null
  }, [layout])

  return { panelsRef, layout }
}
