import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'

export default function ResultSection({
  title,
  children,
  className = '',
  tag,
  alwaysOpen = false,
}: {
  title: string
  children: ReactNode
  className?: string
  tag?: string
  alwaysOpen?: boolean
}) {
  const { desktop, mode, short } = useWorkspaceLayoutContext()
  const expanded =
    alwaysOpen || desktop || (!short && (mode === 'split' || mode === 'book'))
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <section
      className={`result-section ${className}`}
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`} className="result-section-title">
        {expanded ? (
          <>
            <span>{title}</span>
            {tag && <span className="section-tag"> · {tag}</span>}
          </>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => setOpen((value) => !value)}
          >
            <span>{title}</span>
            {tag && <span className="section-tag">{tag}</span>}
            <ChevronDown
              size={14}
              aria-hidden
              className={open ? 'rotate-180' : ''}
            />
          </button>
        )}
      </h3>
      <div
        id={`${id}-body`}
        hidden={!expanded && !open}
        className="result-section-body"
      >
        {children}
      </div>
    </section>
  )
}
