import { UI_LANGS } from '../lib/i18n'
import { useUiLang } from '../hooks/useUiLang'

const LABEL = { en: 'EN', ko: '한' } as const

export default function UiLangToggle() {
  const { lang, setLang } = useUiLang()
  return (
    <div
      className="inline-flex rounded-md border border-border bg-panel p-0.5 text-[11px]"
      role="group"
      aria-label="UI language"
    >
      {UI_LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`rounded px-1.5 py-0.5 font-semibold tracking-wide transition ${
            lang === code
              ? 'bg-accent-soft text-ink'
              : 'text-ink-dim hover:text-ink'
          }`}
        >
          {LABEL[code]}
        </button>
      ))}
    </div>
  )
}
