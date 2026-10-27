import { useLayoutEffect, useRef } from 'react'
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
  const forcedMin = layout.short || layout.keyboard
  const minimized = forcedMin || learning?.minimized
  const restore = () => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="breakdown-button"]')
      ?.focus({ preventScroll: true })
  }
  useLayoutEffect(() => {
    if (forcedMin && learning?.isOpen && !learning.minimized)
      learning.setMinimized(true)
    if ((forcedMin || layout.tight || !learning?.isOpen) && hadFocus.current) {
      hadFocus.current = false
      restore()
    }
  }, [
    forcedMin,
    layout.tight,
    learning?.isOpen,
    learning?.minimized,
    learning?.setMinimized,
  ])
  if (!learning || !compact) return null
  return (
    <section
      ref={root}
      hidden={!learning.isOpen || layout.tight}
      className="learning-panel"
      data-testid="learning-panel"
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
}
