/** These occupy the final controls' boxes without exposing premature actions. */
export function ListenPlaceholder({
  labelled = false,
}: {
  labelled?: boolean
}) {
  return (
    <span
      className={`listen-placeholder ${labelled ? '' : 'icon-action'}`}
      aria-hidden
    >
      <span className="animate-pulse" />
    </span>
  )
}

export function RefinePlaceholder() {
  return (
    <div className="refine-row" aria-hidden>
      <div className="refine-controls refine-placeholder">
        <span className="refine-label-placeholder animate-pulse" />
        {[0, 1, 2, 3, 4].map((index) => (
          <span key={index} className="refine-chip-placeholder animate-pulse" />
        ))}
      </div>
    </div>
  )
}
