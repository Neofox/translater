import { useEffect, useRef } from 'react'

// In laptop posture the first panel ends at the physical fold. Subtract the
// actual header offset rather than assuming a fixed header or safe-area size.
export function useFoldLayout() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const panels = ref.current
    if (!panels) return
    const media = window.matchMedia(
      '(device-posture: folded) and (vertical-viewport-segments: 2)',
    )
    let observer: ResizeObserver | undefined
    const measure = () => {
      panels.style.setProperty(
        '--panels-top',
        `${panels.getBoundingClientRect().top + window.scrollY}px`,
      )
    }
    const sync = () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      if (!media.matches) {
        panels.style.removeProperty('--panels-top')
        return
      }
      measure()
      observer = new ResizeObserver(measure)
      observer.observe(panels)
      const header = panels.parentElement?.querySelector('header')
      if (header) observer.observe(header)
      window.addEventListener('resize', measure)
    }
    sync()
    media.addEventListener('change', sync)
    return () => {
      observer?.disconnect()
      media.removeEventListener('change', sync)
      window.removeEventListener('resize', measure)
      panels.style.removeProperty('--panels-top')
    }
  }, [])
  return ref
}
