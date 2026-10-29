import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  useMemo,
  useRef,
} from 'react'
import type { ReactNode } from 'react'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useUiLang } from '../hooks/useUiLang'
import { useLearning } from '../hooks/useLearning'
import { mainText, resultIsCurrent } from '../lib/liveResult'
import { prepareLearningResult } from '../lib/learningRanges'
import type { TextRange } from '../lib/learningRanges'
import { learningSide } from '../lib/learningSide'
import type { LearningChunk } from '../server/learningTypes'

type LearningValue = Omit<ReturnType<typeof useLearning>, 'openAt'> & {
  openAt: (offset?: number, origin?: 'source' | 'target') => void
  canOpen: boolean
  isSentence: boolean
  preparedChunks: LearningChunk[]
  preparedHighlights: TextRange[]
  side: 'source' | 'target'
  language: string
  wordActivation: number
  restoreSourceFocus?: () => boolean
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
    textareaRef,
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
  const [wordActivation, setWordActivation] = useState(0)
  const [wordMinimized, setWordMinimized] = useState(false)
  const wordIdentity = `${live?.requestKey ?? ''}:${canOpen}`
  const [wordKey, setWordKey] = useState(wordIdentity)
  useLayoutEffect(() => {
    setWordOpen(false)
    setWordMinimized(false)
    setWordKey(wordIdentity)
  }, [wordIdentity])
  const sourceFocus = useRef<{
    node: HTMLTextAreaElement
    start: number
    end: number
    direction: 'forward' | 'backward' | 'none'
    top: number
    left: number
    identity: string
  } | null>(null)
  const restoreSourceFocus = () => {
    const saved = sourceFocus.current
    sourceFocus.current = null
    if (!saved?.node.isConnected || saved.identity !== learning.identity)
      return false
    saved.node.focus({ preventScroll: true })
    saved.node.setSelectionRange(saved.start, saved.end, saved.direction)
    saved.node.scrollTop = saved.top
    saved.node.scrollLeft = saved.left
    return true
  }
  const openAt = useCallback(
    (offset?: number, origin: 'source' | 'target' = 'target') => {
      if (!canOpen) return
      const node = origin === 'source' ? textareaRef.current : null
      sourceFocus.current = node
        ? {
            node,
            start: node.selectionStart,
            end: node.selectionEnd,
            direction: node.selectionDirection,
            top: node.scrollTop,
            left: node.scrollLeft,
            identity: learning.identity,
          }
        : null
      if (isSentence) learning.openAt(offset)
      else {
        setWordKey(wordIdentity)
        setWordOpen(true)
        setWordActivation((count) => count + 1)
      }
    },
    [
      canOpen,
      isSentence,
      learning.openAt,
      wordIdentity,
      textareaRef,
      learning.identity,
    ],
  )
  const close = () => {
    learning.close()
    setWordOpen(false)
  }
  return (
    <LearningContext.Provider
      value={{
        ...learning,
        canOpen: canOpen && (!isSentence || Boolean(prepared?.chunks.length)),
        isSentence,
        side,
        language: side === 'source' ? sourceLanguage : targetLanguage,
        wordActivation,
        preparedChunks: prepared?.chunks ?? [],
        preparedHighlights:
          prepared?.chunks.flatMap((chunk) => chunk.grammarHighlights ?? []) ??
          [],
        openAt,
        restoreSourceFocus,
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
