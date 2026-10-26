import InputPanel from './InputPanel'
import OutputPanel from './OutputPanel'
import ModeToggle from './ModeToggle'
import UiLangToggle from './UiLangToggle'
import { useTranslatorContext } from '../context/TranslatorContext'
import { WorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'

export default function TranslatorWorkspace() {
  const { panelsRef, layout } = useWorkspaceLayout()
  const { mode, setMode } = useTranslatorContext()
  const panels = [<InputPanel key="input" />, <OutputPanel key="output" />]
  if (layout.resultFirst) panels.reverse()
  return (
    <WorkspaceLayoutContext.Provider value={layout}>
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
            <UiLangToggle />
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
    </WorkspaceLayoutContext.Provider>
  )
}
