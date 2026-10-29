import { useId, useLayoutEffect, useRef } from 'react'
import { useLearningContext } from '../context/LearningContext'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import type { StringKey } from '../lib/i18n'
import WordSourceMeta from './WordSourceMeta'
import CharacterNotes from './CharacterNotes'
import { isLearningText } from '../lib/learningRanges'

const FACTS = [
  'gloss',
  'baseForm',
  'literalMeaning',
  'naturalMeaning',
  'grammar',
  'usageNote',
  'omissions',
] as const
const LABELS: Record<(typeof FACTS)[number], StringKey> = {
  gloss: 'inThisSentence',
  baseForm: 'baseForm',
  literalMeaning: 'literalMeaning',
  naturalMeaning: 'naturalMeaning',
  grammar: 'grammar',
  usageNote: 'notes',
  omissions: 'omissions',
}

export default function LearningInspector() {
  const learning = useLearningContext()
  const { live, streaming, lookupWord } = useTranslatorContext()
  const { t } = useUiLang()
  const id = useId()
  const list = useRef<HTMLUListElement>(null)
  const selected = learning?.selectedChunk
  useLayoutEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(
      '[aria-expanded="true"]',
    )
    const scroll = row?.closest<HTMLElement>(
      '.reference-scroll, .learning-panel-body',
    )
    if (!row || !scroll) return
    const top =
      row.getBoundingClientRect().top - scroll.getBoundingClientRect().top
    if (top < 0 || top > scroll.clientHeight - row.offsetHeight)
      scroll.scrollTop += top
  }, [selected?.start])
  if (!live) return null
  return (
    <div className="learning-inspector" data-testid="learning-inspector">
      {live.intent === 'sentence' && learning?.result && (
        <section aria-label={t('wholeSentence')}>
          <ul className="learning-chunks" ref={list}>
            {learning.result.chunks.map((item, index) => {
              if (!isLearningText(item.text)) return null
              const expanded = selected === item
              const detailId = `${id}-phrase-${index}`
              return (
                <li key={`${item.start}:${item.end}`}>
                  <button
                    type="button"
                    aria-label={`${item.text} ${item.gloss || item.naturalMeaning}`}
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={() =>
                      learning.selectChunk(expanded ? null : index)
                    }
                    data-testid="learning-chunk"
                  >
                    <span
                      className={expanded ? 'learning-phrase' : undefined}
                      lang={learning.language}
                    >
                      {item.text}
                    </span>
                    <span aria-hidden="true">→</span>
                    <span>{item.gloss || item.naturalMeaning}</span>
                  </button>
                  {expanded && (
                    <div
                      id={detailId}
                      className="phrase-detail"
                      role="region"
                      aria-label={item.text}
                    >
                      <dl className="learning-facts">
                        {FACTS.filter((key) => item[key]?.trim()).map((key) => (
                          <div key={key}>
                            <dt>{t(LABELS[key])}</dt>
                            <dd
                              lang={
                                key === 'baseForm'
                                  ? learning.language
                                  : undefined
                              }
                            >
                              {item[key]}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <CharacterNotes characters={item.characters} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {learning.result.wordOrder && (
            <p className="learning-order">{learning.result.wordOrder}</p>
          )}
          {learning.result.partial && (
            <p className="learning-status">{t('learningPartial')}</p>
          )}
        </section>
      )}
      {live.intent === 'word' && (
        <section aria-label={t('wordDetails')}>
          <WordSourceMeta
            result={live.partial}
            streaming={streaming}
            onLookup={lookupWord}
          />
        </section>
      )}
    </div>
  )
}
