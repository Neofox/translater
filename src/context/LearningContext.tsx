import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useTranslatorContext } from './TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { useLearning } from '../hooks/useLearning'
import { mainText, resultIsCurrent } from '../lib/liveResult'

type LearningValue = ReturnType<typeof useLearning> & {
  canOpen: boolean
  isSentence: boolean
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
  const learning = useLearning({
    snapshot: canOpen
      ? {
          text: input,
          translation: output,
          sentenceStart: 0,
          sentenceEnd: output.length,
          source: live?.partial.sourceLang ?? source,
          target: live?.partial.targetLang ?? target,
          mode,
          uiLang: lang,
          context,
        }
      : null,
    requestKey: live?.requestKey ?? null,
    enabled: canOpen && isSentence,
  })
  const [wordOpen, setWordOpen] = useState(false)
  const wordIdentity = `${live?.requestKey ?? ''}:${canOpen}`
  const [wordKey, setWordKey] = useState(wordIdentity)
  useLayoutEffect(() => {
    setWordOpen(false)
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
        openAt,
        close,
        isOpen:
          learning.isOpen || (canOpen && wordOpen && wordKey === wordIdentity),
      }}
    >
      {children}
    </LearningContext.Provider>
  )
}
