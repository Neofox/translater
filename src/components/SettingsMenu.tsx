import { useState } from 'react'
import { Settings } from 'lucide-react'
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import { useUiLang } from '../hooks/useUiLang'
import { floatingPanelBoundary } from '../lib/floatingPanelBoundary'
import UiLangToggle from './UiLangToggle'
import Pill from './ui/Pill'

export default function SettingsMenu() {
  const { t } = useUiLang()
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip(floatingPanelBoundary),
      shift(floatingPanelBoundary),
    ],
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ])
  return (
    <>
      <Pill
        size="md"
        ref={refs.setReference}
        className="settings-trigger"
        aria-label={t('settings')}
        data-testid="settings-button"
        {...getReferenceProps()}
      >
        <Settings size={18} aria-hidden />
      </Pill>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={{
                ...floatingStyles,
                visibility: isPositioned ? 'visible' : 'hidden',
              }}
              className="settings-popover"
              aria-label={t('settings')}
              {...getFloatingProps()}
            >
              <h2>{t('settings')}</h2>
              <UiLangToggle />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}
