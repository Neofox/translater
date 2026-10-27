import InputPanel from './InputPanel'
import OutputPanel from './OutputPanel'
import ReferencePanel from './ReferencePanel'
import ModeToggle from './ModeToggle'
import SettingsMenu from './SettingsMenu'
import { useTranslatorContext } from '../context/TranslatorContext'
import { WorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'
import { LearningProvider } from '../context/LearningContext'

export default function TranslatorWorkspace() {
  const { panelsRef, layout } = useWorkspaceLayout()
  const { mode, setMode } = useTranslatorContext()
  const separateReference = ['workspace', 'split', 'book'].includes(layout.mode)
  const panels = [
    <InputPanel key="input">
      {separateReference && <ReferencePanel />}
    </InputPanel>,
    <OutputPanel key="output" />,
  ]
  if (layout.resultFirst) panels.reverse()
  return (
    <WorkspaceLayoutContext.Provider value={layout}>
      <LearningProvider>
        <main
          className="app-shell"
          data-layout={layout.mode}
          data-desktop={layout.desktop || undefined}
          data-short={layout.short || undefined}
          data-tight={layout.tight || undefined}
          data-keyboard={layout.keyboard || undefined}
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
              <SettingsMenu />
            </div>
          </header>
          <div
            ref={panelsRef}
            className="translator-panels"
            data-layout={layout.mode}
            data-result-first={layout.resultFirst || undefined}
            data-desktop={layout.desktop || undefined}
            data-short={layout.short || undefined}
            data-tight={layout.tight || undefined}
            data-keyboard={layout.keyboard || undefined}
          >
            {panels}
          </div>
        </main>
      </LearningProvider>
    </WorkspaceLayoutContext.Provider>
  )
}
