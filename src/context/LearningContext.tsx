import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  useMemo,
} from 'react'
import type { ReactNode } from 'react'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { useLearning } from '../hooks/useLearning'
import { mainText, resultIsCurrent } from '../lib/liveResult'
import { prepareLearningResult } from '../lib/learningRanges'
import { learningSide } from '../lib/learningSide'
import type { LearningChunk } from '../server/learningTypes'

type LearningValue = ReturnType<typeof useLearning> & {
  canOpen: boolean
  isSentence: boolean
  preparedChunks: LearningChunk[]
  side: 'source' | 'target'
  language: string
}
const LearningContext = createContext<LearningValue | null>(null)
export const useLearningContext = () => useContext(LearningContext)

export function LearningProvider({ children }: { children: ReactNode }) {
  const translator = useTranslatorContext()
  const { lang } = useUiLang()
  const {
    live,
    input,
    source,
    target,
    mode,
    context,
    refinements,
    isPending,
    streaming,
    error,
  } = translator
  const output = mainText(live) ?? ''
  const canOpen = Boolean(
    live?.done &&
    !isPending &&
    !streaming &&
    !error &&
    output &&
    resultIsCurrent(live, {
      text: input,
      source,
      target,
      mode,
      context,
      refinements,
      uiLang: lang,
    }),
  )
  const isSentence = live?.intent === 'sentence'
  const sourceLanguage = live?.partial.sourceLang ?? source
  const targetLanguage = live?.partial.targetLang ?? target
  const side = learningSide(sourceLanguage, targetLanguage, lang)
  const learningText = side === 'source' ? input : output
  const counterpart = side === 'source' ? output : input
  const phrases =
    live?.intent === 'sentence' ? live.partial.learningPhrases : undefined
  const prepared = useMemo(
    () =>
      canOpen && isSentence
        ? prepareLearningResult(counterpart, learningText, phrases)
        : null,
    [canOpen, isSentence, counterpart, learningText, phrases],
  )
  const learning = useLearning({
    prepared,
    hasPreparedMap: Array.isArray(phrases),
    snapshot: canOpen
      ? {
          text: input,
          translation: output,
          sentenceStart: 0,
          sentenceEnd: learningText.length,
          source: sourceLanguage,
          target: targetLanguage,
          side,
          mode,
          uiLang: lang,
          context,
        }
      : null,
    requestKey: live?.requestKey ?? null,
    enabled: canOpen && isSentence,
  })
  const [wordOpen, setWordOpen] = useState(false)
  const [wordMinimized, setWordMinimized] = useState(false)
  const wordIdentity = `${live?.requestKey ?? ''}:${canOpen}`
  const [wordKey, setWordKey] = useState(wordIdentity)
  useLayoutEffect(() => {
    setWordOpen(false)
    setWordMinimized(false)
    setWordKey(wordIdentity)
  }, [wordIdentity])
  const openAt = useCallback(
    (offset?: number) => {
      if (!canOpen) return
      if (isSentence) learning.openAt(offset)
      else {
        setWordKey(wordIdentity)
        setWordOpen(true)
      }
    },
    [canOpen, isSentence, learning.openAt, wordIdentity],
  )
  const close = () => {
    learning.close()
    setWordOpen(false)
  }
  return (
    <LearningContext.Provider
      value={{
        ...learning,
        canOpen,
        isSentence,
        side,
        language: side === 'source' ? sourceLanguage : targetLanguage,
        preparedChunks: prepared?.chunks ?? [],
        openAt,
        close,
        isOpen:
          learning.isOpen || (canOpen && wordOpen && wordKey === wordIdentity),
        minimized: isSentence ? learning.minimized : wordMinimized,
        setMinimized: isSentence ? learning.setMinimized : setWordMinimized,
      }}
    >
      {children}
    </LearningContext.Provider>
  )
}
