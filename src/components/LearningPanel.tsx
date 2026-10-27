import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { useLearningContext } from '../context/LearningContext'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useUiLang } from '../hooks/useUiLang'
import LearningInspector from './LearningInspector'
import Pill from './ui/Pill'

export default function LearningPanel() {
  const learning = useLearningContext()
  const layout = useWorkspaceLayoutContext()
  const { t } = useUiLang()
  const root = useRef<HTMLElement>(null)
  const hadFocus = useRef(false)
  const compact = layout.resultFirst
  // A tight viewport reuses output scrolling instead of reserving a third row.
  const inline = compact && layout.tight
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const previous = useRef({ short: layout.short, open: false })
  const forcedMin = layout.keyboard && !inline
  const minimized = forcedMin || learning?.minimized
  const restore = () => {
    if (inline) {
      const scroll = document.querySelector('.result-scroll')
      if (scroll) scroll.scrollTop = 0
    }
    document
      .querySelector<HTMLButtonElement>('[data-testid="breakdown-button"]')
      ?.focus({ preventScroll: true })
  }
  useLayoutEffect(() => {
    const enteredShort =
      layout.short &&
      !inline &&
      (!previous.current.short || (!previous.current.open && learning?.isOpen))
    previous.current = { short: layout.short, open: learning?.isOpen ?? false }
    if ((forcedMin || enteredShort) && learning?.isOpen && !learning.minimized)
      learning.setMinimized(true)
    const active = document.activeElement
    const losingPanelFocus =
      root.current?.contains(active) ||
      (active === document.body && hadFocus.current)
    if (
      (forcedMin || enteredShort || !learning?.isOpen || !compact) &&
      losingPanelFocus
    ) {
      hadFocus.current = false
      restore()
    }
  }, [
    compact,
    inline,
    forcedMin,
    layout.short,
    learning?.isOpen,
    learning?.minimized,
    learning?.setMinimized,
  ])
  useLayoutEffect(() => {
    const next =
      inline && learning?.isOpen
        ? document.querySelector<HTMLElement>(
            '[data-testid="tight-learning-slot"]',
          )
        : null
    if (next !== portalTarget) setPortalTarget(next)
    if (next && next === portalTarget) {
      const scroll = next.closest('.result-scroll')
      if (scroll)
        scroll.scrollTop +=
          next.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top -
          60
    }
  }, [
    inline,
    learning?.isOpen,
    learning?.status,
    learning?.selectedChunk?.start,
    learning?.selectedSentence,
    portalTarget,
  ])
  if (!learning || !compact || !learning.isOpen || (inline && !portalTarget))
    return null
  const panel = (
    <section
      ref={root}
      className="learning-panel"
      data-testid="learning-panel"
      data-tight-inline={inline || undefined}
      aria-label={t('learn')}
      onFocusCapture={() => {
        hadFocus.current = true
      }}
      onBlurCapture={(event) => {
        if (event.relatedTarget && !root.current?.contains(event.relatedTarget))
          hadFocus.current = false
      }}
    >
      <div className="learning-panel-header">
        <h2>
          {t('learn')}
          {learning.selectedChunk ? ` · ${learning.selectedChunk.text}` : ''}
        </h2>
        {minimized ? (
          <Pill
            tone="warm"
            size="md"
            disabled={forcedMin}
            onClick={() => learning.setMinimized(false)}
            aria-label={t('showLearning')}
          >
            {t('showLearning')}
          </Pill>
        ) : (
          <Pill
            size="md"
            onClick={() => {
              learning.setMinimized(true)
              restore()
            }}
            aria-label={t('minimizeLearning')}
          >
            <ChevronDown size={18} />
          </Pill>
        )}
        <Pill
          size="md"
          onClick={() => {
            learning.close()
            restore()
          }}
          aria-label={t('closeLearning')}
        >
          <X size={18} />
        </Pill>
      </div>
      <div className="learning-panel-body scrollbar-thin" hidden={minimized}>
        <LearningInspector />
      </div>
    </section>
  )
  return inline && portalTarget ? createPortal(panel, portalTarget) : panel
}
