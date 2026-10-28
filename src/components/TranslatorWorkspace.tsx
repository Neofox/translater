import InputPanel from './InputPanel'
import OutputPanel from './OutputPanel'
import ReferencePanel from './ReferencePanel'
import ModeToggle from './ModeToggle'
import SettingsMenu from './SettingsMenu'
import AdjustMenu from './AdjustMenu'
import { useTranslatorContext } from '../context/TranslatorContext'
import { WorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'
import { LearningProvider } from '../context/LearningContext'

export default function TranslatorWorkspace() {
  const { panelsRef, layout, measured } = useWorkspaceLayout()
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
              <AdjustMenu />
              <SettingsMenu />
            </div>
          </header>
          <div className="workspace-viewport">
            <div
              ref={panelsRef}
              className="translator-panels"
              data-layout-pending={!measured || undefined}
              data-layout={layout.mode}
              data-result-first={layout.resultFirst || undefined}
              data-desktop={layout.desktop || undefined}
              data-short={layout.short || undefined}
              data-tight={layout.tight || undefined}
              data-keyboard={layout.keyboard || undefined}
            >
              {panels}
            </div>
          </div>
        </main>
      </LearningProvider>
    </WorkspaceLayoutContext.Provider>
  )
}
