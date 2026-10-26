import InputPanel from './InputPanel'
import OutputPanel from './OutputPanel'
import ModeToggle from './ModeToggle'
import UiLangToggle from './UiLangToggle'
import { useTranslatorContext } from '../context/TranslatorContext'
import { WorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'
import { useUiLang } from '../hooks/useUiLang'
import { useKbd } from '../hooks/useKbd'

export default function TranslatorWorkspace() {
  const { panelsRef, layout } = useWorkspaceLayout()
  const { mode, setMode } = useTranslatorContext()
  const { t } = useUiLang()
  const { mod, shift } = useKbd()
  const panels = [<InputPanel key="input" />, <OutputPanel key="output" />]
  if (layout.resultFirst) panels.reverse()
  return (
    <WorkspaceLayoutContext.Provider value={layout}>
      <main
        className="app-shell"
        data-layout={layout.mode}
        data-desktop={layout.desktop || undefined}
        data-tight={layout.tight || undefined}
      >
        <header className="app-header">
          <div className="app-brand">
            <span className="brand-glyph" aria-hidden>
              가
            </span>
            <h1>Translater</h1>
          </div>
          <div className="app-settings">
            <ModeToggle value={mode} onChange={setMode} />
            <UiLangToggle />
          </div>
        </header>
        <div
          ref={panelsRef}
          className="translator-panels"
          data-layout={layout.mode}
          data-result-first={layout.resultFirst || undefined}
          data-desktop={layout.desktop || undefined}
          data-tight={layout.tight || undefined}
        >
          {panels}
        </div>
        <footer className="app-footer">
          <span>
            <kbd>{mod}↵</kbd> {t('kbdForce')}
          </span>
          <span>
            <kbd>{mod}K</kbd> {t('kbdFocus')}
          </span>
          <span>
            <kbd>
              {mod}
              {shift}C
            </kbd>{' '}
            {t('kbdCopy')}
          </span>
          <span>
            <kbd>Esc</kbd> {t('kbdClear')}
          </span>
        </footer>
      </main>
    </WorkspaceLayoutContext.Provider>
  )
}
