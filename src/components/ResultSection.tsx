import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'

export default function ResultSection({
  title,
  children,
  className = '',
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  const { desktop } = useWorkspaceLayoutContext()
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <section
      className={`result-section ${className}`}
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`} className="result-section-title">
        {desktop ? (
          title
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => setOpen((value) => !value)}
          >
            <span>{title}</span>
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
        hidden={!desktop && !open}
        className="result-section-body"
      >
        {children}
      </div>
    </section>
  )
}
