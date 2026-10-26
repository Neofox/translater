import type { LearningTips as LearningTipsType } from '../server/schemas'
import { useUiLang } from '../hooks/useUiLang'
import type { StringKey } from '../lib/i18n'
import ResultSection from './ResultSection'

function characterLabelKey(word: string | undefined): StringKey {
  if (!word) return 'characters'
  if (/[\uAC00-\uD7AF]/.test(word)) return 'hanja'
  if (/[\u3040-\u30FF]/.test(word)) return 'kanji'
  if (/[\u4E00-\u9FFF]/.test(word)) return 'hanzi'
  return 'characters'
}

export default function LearningTips({
  tips,
}: {
  tips?: Partial<LearningTipsType>
}) {
  const { t } = useUiLang()
  const grammar = tips?.grammar?.trim() ?? ''
  const vocab = tips?.vocab?.trim() ?? ''
  const characters = (tips?.characters ?? []).filter(
    (item) => item.word && Array.isArray(item.chars) && item.chars.length,
  )
  if (!grammar && !vocab && !characters.length) return null
  return (
    <ResultSection title={t('learningTips')} className="detail-learning">
      {grammar && (
        <div>
          <h4>{t('grammar')}</h4>
          <p>{grammar}</p>
        </div>
      )}
      {vocab && (
        <div>
          <h4>{t('vocab')}</h4>
          <p>{vocab}</p>
        </div>
      )}
      {characters.length > 0 && (
        <div>
          <h4>{t(characterLabelKey(characters[0]?.word))}</h4>
          {characters.map((item, index) => (
            <p key={`${item.word}-${index}`}>
              <strong className="text-warm">{item.word}</strong>{' '}
              {item.chars
                .map((char) => `${char.char} (${char.meaning})`)
                .join(' · ')}
            </p>
          ))}
        </div>
      )}
    </ResultSection>
  )
}
