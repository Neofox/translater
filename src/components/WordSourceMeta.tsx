import { useEffect, useState } from 'react'
import type { WordResult } from '../server/schemas'

type Props = {
  result: Partial<WordResult>
  streaming?: boolean
  onLookup?: (text: string) => void
}

type SectionKey = 'primary' | 'other' | 'etymology' | 'notes' | 'synonyms'

export default function WordSourceMeta({ result, streaming, onLookup }: Props) {
  const posList = result.posList ?? []
  const synonyms = result.synonyms ?? []
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    if (activeIdx >= posList.length && posList.length > 0) setActiveIdx(0)
  }, [posList.length, activeIdx])

  const activePos = posList[activeIdx]
  const primary = activePos?.senses?.[0]
  const otherWithinPos = activePos?.senses?.slice(1) ?? []
  const otherPosGroups = posList.filter((_, i) => i !== activeIdx)
  const hasOther = otherWithinPos.length > 0 || otherPosGroups.length > 0

  const ready: Record<SectionKey, boolean> = {
    primary: !!primary?.definition,
    other: hasOther,
    etymology: !!result.etymology,
    notes: !!result.notes,
    synonyms: synonyms.length > 0,
  }

  const sectionOrder: SectionKey[] = [
    'primary',
    'other',
    'etymology',
    'notes',
    'synonyms',
  ]

  const hasAny = posList.length > 0 || sectionOrder.some((k) => ready[k])
  if (!hasAny && !streaming) return null

  const streamingKey = streaming
    ? (sectionOrder.find((k) => ready[k] === false) ?? null)
    : null

  return (
    <div className="shrink-0 border-t border-border px-4 py-4 text-sm text-ink-soft sm:px-6">
      {posList.length > 1 && (
        <PosTabs
          posList={posList}
          activeIdx={activeIdx}
          onSelect={setActiveIdx}
        />
      )}

      {activePos && <PosLabel pos={activePos.pos} />}

      {ready.primary && <PrimaryBlock primary={primary!} />}
      {streamingKey === 'primary' && <SkeletonBlock label="Primary meaning" />}

      {ready.other && (
        <OtherBlock within={otherWithinPos} groups={otherPosGroups} />
      )}
      {streamingKey === 'other' && <SkeletonBlock label="Other meanings" />}

      {ready.etymology && (
        <TextBlock label="Etymology" text={result.etymology!} />
      )}
      {streamingKey === 'etymology' && <SkeletonBlock label="Etymology" />}

      {ready.notes && <TextBlock label="Notes" text={result.notes!} />}
      {streamingKey === 'notes' && <SkeletonBlock label="Notes" />}

      {ready.synonyms && (
        <SynonymBlock synonyms={synonyms} onLookup={onLookup} />
      )}
      {streamingKey === 'synonyms' && (
        <SkeletonRow>
          <div className="flex gap-1.5">
            <div className="h-5 w-14 rounded-full bg-ink-dim/10" />
            <div className="h-5 w-12 rounded-full bg-ink-dim/10" />
            <div className="h-5 w-16 rounded-full bg-ink-dim/10" />
          </div>
        </SkeletonRow>
      )}

      {streaming && !streamingKey && posList.length === 0 && (
        <div className="animate-pulse space-y-4">
          <div className="flex gap-1.5">
            <div className="h-6 w-14 rounded-full bg-ink-dim/10" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-24 rounded bg-ink-dim/10" />
            <div className="h-4 w-full rounded bg-ink-dim/10" />
            <div className="h-3 w-3/4 rounded bg-ink-dim/10" />
          </div>
        </div>
      )}
    </div>
  )
}

function PosTabs({
  posList,
  activeIdx,
  onSelect,
}: {
  posList: NonNullable<Partial<WordResult>['posList']>
  activeIdx: number
  onSelect: (i: number) => void
}) {
  return (
    <div className="animate-settle mb-4 flex flex-wrap gap-1.5">
      {posList.map((p, i) => (
        <button
          key={`${p.pos}-${i}`}
          type="button"
          onClick={() => onSelect(i)}
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
  )
}

function PosLabel({ pos }: { pos: string }) {
  return (
    <div
      className="animate-settle mb-3 flex items-baseline gap-2"
      style={{ animationDelay: '30ms' }}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-dim">
        Part of speech
      </span>
      <span className="italic text-ink">{pos}</span>
    </div>
  )
}

function PrimaryBlock({
  primary,
}: {
  primary: NonNullable<
    NonNullable<Partial<WordResult>['posList']>[number]['senses']
  >[number]
}) {
  return (
    <div className="animate-settle mb-3" style={{ animationDelay: '60ms' }}>
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
  )
}

function OtherBlock({
  within,
  groups,
}: {
  within: NonNullable<
    NonNullable<Partial<WordResult>['posList']>[number]['senses']
  >
  groups: NonNullable<Partial<WordResult>['posList']>
}) {
  return (
    <div className="animate-settle mb-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-dim">
        Other meanings
      </p>
      <ol className="space-y-2 pl-4">
        {within.map((s, i) => (
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
        {groups.map((group, gi) =>
          group.senses?.map((s, si) => (
            <li key={`cross-${gi}-${si}`} className="text-ink">
              <span className="mr-2 text-ink-dim">({group.pos})</span>
              {s.definition}
            </li>
          )),
        )}
      </ol>
    </div>
  )
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="animate-settle mb-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-dim">
        {label}
      </p>
      <p className="text-ink">{text}</p>
    </div>
  )
}

function SynonymBlock({
  synonyms,
  onLookup,
}: {
  synonyms: string[]
  onLookup?: (text: string) => void
}) {
  return (
    <div className="animate-settle">
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
  )
}

function SkeletonBlock({ label }: { label: string }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-dim">
        {label}
      </p>
      <div className="animate-pulse space-y-2">
        <div className="h-4 w-full rounded bg-ink-dim/10" />
        <div className="h-3 w-3/4 rounded bg-ink-dim/10" />
      </div>
    </div>
  )
}

function SkeletonRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="animate-pulse space-y-2">
        <div className="h-3 w-16 rounded bg-ink-dim/10" />
        {children}
      </div>
    </div>
  )
}
