import { Link } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'

export default function ErrorView({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 p-6 text-center text-ink">
      <p className="text-sm font-semibold tracking-tight text-warm">Error</p>
      <p className="text-ink-soft text-sm">{message}</p>
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={reset}
          className="text-accent underline-offset-2 hover:underline"
        >
          Retry
        </button>
        <span className="text-ink-dim">·</span>
        <Link to="/" className="text-accent underline-offset-2 hover:underline">
          Back to translator
        </Link>
      </div>
      {stack && (
        <details className="mt-4 w-full max-w-2xl text-left">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-warm">
            Stack
          </summary>
          <pre className="mt-2 overflow-auto rounded-lg border border-border bg-panel p-3 text-[11px] leading-relaxed text-ink-soft scrollbar-thin font-mono">
            {stack}
          </pre>
        </details>
      )}
    </main>
  )
}
