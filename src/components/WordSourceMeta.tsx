/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Streamed JSON can omit nested fields until final schema validation. */
import { useEffect, useState } from 'react'
import type { WordResult } from '../server/schemas'
import Tag from './ui/Tag'
import CharacterNotes from './CharacterNotes'
import { useUiLang } from '../hooks/useUiLang'

type Props = {
  result: Partial<WordResult>
  streaming?: boolean
  onLookup?: (text: string) => void
}

type SectionKey =
  | 'primary'
  | 'other'
  | 'etymology'
  | 'grammar'
  | 'characters'
  | 'notes'
  | 'synonyms'

export default function WordSourceMeta({ result, streaming, onLookup }: Props) {
  const { t } = useUiLang()
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
    grammar: !!result.grammar,
    characters: !!result.characters?.length,
    synonyms: synonyms.length > 0,
  }

  const sectionOrder: SectionKey[] = [
    'primary',
    'other',
    'etymology',
    'grammar',
    'notes',
    'characters',
    'synonyms',
  ]

  const hasAny = posList.length > 0 || sectionOrder.some((k) => ready[k])
  if (!hasAny && !streaming) return null

  const streamingKey = streaming
    ? (sectionOrder.find((k) => ready[k] === false) ?? null)
    : null

  return (
    <div className="word-source-meta shrink-0 py-4 text-sm text-ink-soft">
      {posList.length > 1 && (
        <PosTabs
          posList={posList}
          activeIdx={activeIdx}
          onSelect={setActiveIdx}
        />
      )}

      {activePos && <PosLabel pos={activePos.pos} label={t('pos')} />}

      {ready.primary && (
        <PrimaryBlock primary={primary!} label={t('primaryMeaning')} />
      )}
      {streamingKey === 'primary' && (
        <SkeletonBlock label={t('primaryMeaning')} />
      )}

      {ready.other && (
        <OtherBlock
          within={otherWithinPos}
          groups={otherPosGroups}
          label={t('otherMeanings')}
        />
      )}
      {streamingKey === 'other' && <SkeletonBlock label={t('otherMeanings')} />}

      {ready.etymology && (
        <TextBlock label={t('etymology')} text={result.etymology!} />
      )}
      {streamingKey === 'etymology' && <SkeletonBlock label={t('etymology')} />}

      {ready.grammar && (
        <TextBlock label={t('grammar')} text={result.grammar!} />
      )}
      {streamingKey === 'grammar' && <SkeletonBlock label={t('grammar')} />}
      {ready.characters && <CharacterNotes characters={result.characters} />}
      {streamingKey === 'characters' && (
        <SkeletonBlock label={t('characters')} />
      )}

      {ready.notes && <TextBlock label={t('notes')} text={result.notes!} />}
      {streamingKey === 'notes' && <SkeletonBlock label={t('notes')} />}

      {ready.synonyms && (
        <SynonymBlock
          synonyms={synonyms}
          onLookup={onLookup}
          label={t('synonyms')}
        />
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
          className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition ${
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

function PosLabel({ pos, label }: { pos: string; label: string }) {
  return (
    <div
      className="animate-settle mb-3 flex items-baseline gap-2"
      style={{ animationDelay: '30ms' }}
    >
      <span className="dictionary-label text-xs font-semibold uppercase tracking-wide">
        {label}
      </span>
      <span className="italic text-ink">{pos}</span>
    </div>
  )
}

function PrimaryBlock({
  primary,
  label,
}: {
  primary: NonNullable<
    NonNullable<Partial<WordResult>['posList']>[number]['senses']
  >[number]
  label: string
}) {
  return (
    <div className="animate-settle mb-3" style={{ animationDelay: '60ms' }}>
      <p className="mb-1 dictionary-label text-xs font-semibold uppercase tracking-wide">
        {label}
      </p>
      <p className="text-ink">{primary.definition}</p>
      {primary.register?.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {primary.register.map((r) => (
            <Tag key={r} tone="neutral">
              {r}
            </Tag>
          ))}
        </div>
      )}
      {primary.examples?.length > 0 && (
        <ul className="mt-2 space-y-1 pl-4">
          {primary.examples.map((ex, i) => (
            <li
              key={i}
              className="text-ink-soft before:mr-2 before:text-ink-dim before:content-['•']"
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
  label,
}: {
  within: NonNullable<
    NonNullable<Partial<WordResult>['posList']>[number]['senses']
  >
  groups: NonNullable<Partial<WordResult>['posList']>
  label: string
}) {
  return (
    <div className="animate-settle mb-3">
      <p className="mb-1.5 dictionary-label text-xs font-semibold uppercase tracking-wide">
        {label}
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
                    className="text-ink-soft text-[13px] before:mr-2 before:text-ink-dim before:content-['•']"
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
      <p className="mb-1 dictionary-label text-xs font-semibold uppercase tracking-wide">
        {label}
      </p>
      <p className="text-ink">{text}</p>
    </div>
  )
}

function SynonymBlock({
  synonyms,
  onLookup,
  label,
}: {
  synonyms: string[]
  onLookup?: (text: string) => void
  label: string
}) {
  return (
    <div className="animate-settle">
      <p className="mb-1.5 dictionary-label text-xs font-semibold uppercase tracking-wide">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {synonyms.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onLookup?.(s)}
            disabled={!onLookup}
            className="cursor-pointer rounded-full border border-border bg-panel px-2.5 py-0.5 text-xs text-ink-soft transition hover:border-accent/60 hover:text-ink disabled:cursor-default"
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
      <p className="mb-1.5 dictionary-label text-xs font-semibold uppercase tracking-wide">
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
