import { useLayoutEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useLearningContext } from '../context/LearningContext'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useUiLang } from '../hooks/useUiLang'
import LearningInspector from './LearningInspector'
import Pill from './ui/Pill'

/** A deliberate mobile reading view. The original action dock stays mounted. */
export default function LearningPanel() {
  const learning = useLearningContext()
  const layout = useWorkspaceLayoutContext()
  const { t } = useUiLang()
  const closeButton = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const open = Boolean(learning?.isOpen && !layout.desktop)
  useLayoutEffect(() => {
    if (open) closeButton.current?.focus({ preventScroll: true })
    else if (wasOpen.current && !learning?.restoreSourceFocus?.())
      (
        document.querySelector<HTMLElement>(
          '[data-testid="word-details-trigger"]',
        ) ??
        document.querySelector<HTMLElement>('[data-testid="main-translation"]')
      )?.focus({ preventScroll: true })
    wasOpen.current = open
  }, [open])
  if (!learning || !open) return null
  const close = () => {
    learning.close()
  }
  return (
    <section
      className="learning-panel"
      data-testid="learning-panel"
      data-expanded
      aria-label={t('learn')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
        }
      }}
    >
      <div className="learning-panel-header">
        <h2>
          {t('learn')}
          {learning.selectedChunk ? ` · ${learning.selectedChunk.text}` : ''}
        </h2>
        <Pill
          ref={closeButton}
          size="md"
          onClick={close}
          aria-label={t('closeLearning')}
        >
          <X size={18} />
        </Pill>
      </div>
      <div className="learning-panel-body scrollbar-thin">
        <LearningInspector />
      </div>
    </section>
  )
}
