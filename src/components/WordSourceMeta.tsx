import { useEffect, useState } from 'react'
import type { WordResult } from '../server/schemas'

type Props = {
  result: Partial<WordResult>
  onLookup?: (text: string) => void
}

export default function WordSourceMeta({ result, onLookup }: Props) {
  const posList = result.posList ?? []
  const synonyms = result.synonyms ?? []
  const [activeIdx, setActiveIdx] = useState(0)

  // If streaming adds/removes POS entries, keep the active index in range.
  useEffect(() => {
    if (activeIdx >= posList.length && posList.length > 0) setActiveIdx(0)
  }, [posList.length, activeIdx])

  const activePos = posList[activeIdx]
  const primary = activePos?.senses[0]
  const otherWithinPos = activePos?.senses.slice(1) ?? []
  const otherPosGroups = posList.filter((_, i) => i !== activeIdx)

  const showPanel =
    posList.length > 0 ||
    !!result.etymology ||
    !!result.notes ||
    synonyms.length > 0
  if (!showPanel) return null

  return (
    <div className="max-h-[45vh] overflow-y-auto border-t border-border px-4 py-4 text-sm text-ink-soft scrollbar-thin sm:px-6">
      {posList.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {posList.map((p, i) => (
            <button
              key={`${p.pos}-${i}`}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                i === activeIdx
                  ? 'border-accent/60 bg-accent-soft text-ink'
                  : 'border-border bg-panel text-ink-soft hover:text-ink'
              }`}
            >
              {p.pos}
            </button>
          ))}
        </div>
      )}

      {activePos && (
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Part of speech
          </span>
          <span className="italic text-ink">{activePos.pos}</span>
        </div>
      )}

      {primary && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Primary meaning
          </p>
          <p className="text-ink">{primary.definition}</p>
          {primary.register?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {primary.register.map((r) => (
                <span
                  key={r}
                  className="rounded bg-panel px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-dim"
                >
                  {r}
                </span>
              ))}
            </div>
          )}
          {primary.examples?.length > 0 && (
            <ul className="mt-2 space-y-1 pl-4">
              {primary.examples.map((ex, i) => (
                <li
                  key={i}
                  className="text-ink-soft before:mr-2 before:text-ink-dim before:content-['—']"
                >
                  {ex}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(otherWithinPos.length > 0 || otherPosGroups.length > 0) && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Other meanings
          </p>
          <ol className="space-y-2 pl-4">
            {otherWithinPos.map((s, i) => (
              <li key={`same-${i}`} className="text-ink">
                <span className="mr-2 text-ink-dim">{i + 2}.</span>
                {s.definition}
                {s.examples?.length > 0 && (
                  <ul className="mt-1 space-y-0.5 pl-4">
                    {s.examples.map((ex, j) => (
                      <li
                        key={j}
                        className="text-ink-soft text-[13px] before:mr-2 before:text-ink-dim before:content-['—']"
                      >
                        {ex}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {otherPosGroups.map((group, gi) =>
              group.senses.map((s, si) => (
                <li key={`cross-${gi}-${si}`} className="text-ink">
                  <span className="mr-2 text-ink-dim">({group.pos})</span>
                  {s.definition}
                </li>
              )),
            )}
          </ol>
        </div>
      )}

      {result.etymology && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Etymology
          </p>
          <p className="text-ink">{result.etymology}</p>
        </div>
      )}

      {result.notes && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Notes
          </p>
          <p className="text-ink">{result.notes}</p>
        </div>
      )}

      {synonyms.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Synonyms
          </p>
          <div className="flex flex-wrap gap-1.5">
            {synonyms.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onLookup?.(s)}
                disabled={!onLookup}
                className="rounded-full border border-border bg-panel px-2.5 py-0.5 text-xs text-ink-soft transition hover:border-accent/60 hover:text-ink disabled:cursor-default"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
