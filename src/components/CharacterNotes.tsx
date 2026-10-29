/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Nested streamed fields can be incomplete. */
import type { CharacterBreakdownData } from '../server/learningTypes'
import { useUiLang } from '../hooks/useUiLang'
import type { StringKey } from '../lib/i18n'

function characterLabelKey(word: string | undefined): StringKey {
  if (!word) return 'characters'
  if (/[\uAC00-\uD7AF]/.test(word)) return 'hanja'
  if (/[\u3040-\u30FF]/.test(word)) return 'kanji'
  if (/[\u4E00-\u9FFF]/.test(word)) return 'hanzi'
  return 'characters'
}

export default function CharacterNotes({
  characters,
}: {
  characters?: CharacterBreakdownData[]
}) {
  const { t } = useUiLang()
  const notes = (characters ?? []).filter(
    (item) => item.word && Array.isArray(item.chars) && item.chars.length,
  )
  if (!notes.length) return null
  return (
    <div className="character-notes">
      <p className="dictionary-label">{t(characterLabelKey(notes[0]?.word))}</p>
      {notes.map((item, index) => (
        <p key={`${item.word}-${index}`}>
          <strong className="text-warm">{item.word}</strong>{' '}
          {item.chars
            .map((char) => `${char.char ?? ''} (${char.meaning ?? ''})`)
            .join(' · ')}
        </p>
      ))}
    </div>
  )
}
