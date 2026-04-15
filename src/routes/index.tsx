import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DebugBar from '../components/DebugBar'
import InputPanel from '../components/InputPanel'
import ModeToggle from '../components/ModeToggle'
import OutputPanel from '../components/OutputPanel'
import { detectIntent } from '../lib/detectIntent'
import { useAutoSwapTarget } from '../hooks/useAutoSwapTarget'
import { useTranslate } from '../hooks/useTranslate'
import type { LiveResult } from '../hooks/useTranslate'
import type { Meta } from '../server/translate'
import { useTranslationPrefs } from '../hooks/useTranslationPrefs'
import { useTranslatorShortcuts } from '../hooks/useTranslatorShortcuts'

export const Route = createFileRoute('/')({ component: Translator })

function Translator() {
  const prefs = useTranslationPrefs()
  const {
    input,
    setInput,
    source,
    setSource,
    target,
    setTarget,
    prevTarget,
    mode,
    setMode,
  } = prefs

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const intent = useMemo(() => detectIntent(input), [input])

  const { live, isPending, streaming, error, run, reset } = useTranslate({
    text: input,
    source,
    target,
    mode,
    intent,
  })

  useAutoSwapTarget({ input, source, target, prevTarget, setTarget })

  // Session totals: persist across input clears, reset on page refresh.
  const [lastMeta, setLastMeta] = useState<Meta | null>(null)
  const [sessionCostUsd, setSessionCostUsd] = useState(0)
  const [sessionCount, setSessionCount] = useState(0)
  const countedMetaRef = useRef<Meta | null>(null)

  useEffect(() => {
    const meta = live?.meta
    if (!live?.done || !meta) return
    setLastMeta(meta)
    if (countedMetaRef.current === meta) return
    countedMetaRef.current = meta
    // Skip cache hits — no provider call, no new cost incurred this session.
    if (meta.durationMs === 0) return
    setSessionCount((n) => n + 1)
    if (typeof meta.costUsd === 'number') {
      setSessionCostUsd((c) => c + (meta.costUsd ?? 0))
    }
  }, [live])

  // Focus input on mount, but not on touch devices (avoids popping the keyboard).
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) {
      textareaRef.current?.focus()
    }
  }, [])

  const clearInput = useCallback(() => {
    setInput('')
    reset()
    textareaRef.current?.focus()
  }, [setInput, reset])

  useTranslatorShortcuts({
    hasInput: Boolean(input),
    live,
    onForce: () => void run(),
    onCopy: () => {
      const text = getMainText(live)
      if (text) void navigator.clipboard.writeText(text)
    },
    onFocusInput: () => {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    },
    onClear: clearInput,
  })

  return (
    <main className="flex min-h-[100dvh] flex-col md:h-[100dvh]">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-bg/90 px-3 py-2 backdrop-blur-sm sm:gap-3 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          <h1 className="text-sm font-semibold tracking-tight text-ink">
            Translater
          </h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <ModeToggle value={mode} onChange={setMode} />
        </div>
      </header>

      <div className="relative flex flex-1 flex-col md:grid md:grid-cols-2 md:overflow-hidden">
        <InputPanel
          ref={textareaRef}
          input={input}
          setInput={setInput}
          source={source}
          setSource={setSource}
          intent={intent}
          live={live}
          streaming={streaming}
          error={error}
          onSubmit={() => void run()}
          onClear={clearInput}
          onLookup={(text) => {
            setInput(text)
            textareaRef.current?.focus()
          }}
        />

        <OutputPanel
          target={target}
          setTarget={setTarget}
          mode={mode}
          live={live}
          isPending={isPending}
          streaming={streaming}
          error={error}
        />
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-1.5 text-[11px] text-white/80 sm:px-4">
        <ShortcutHints />
        <div className="ml-auto">
          <DebugBar
            meta={live?.meta ?? lastMeta}
            cached={(live?.meta ?? lastMeta)?.durationMs === 0}
            sessionCostUsd={sessionCostUsd}
            sessionCount={sessionCount}
          />
        </div>
      </footer>
    </main>
  )
}

function ShortcutHints() {
  return (
    <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-x-4">
      <span>
        <kbd className="kbd">↵</kbd> translate
      </span>
      <span>
        <kbd className="kbd">⌘↵</kbd> force
      </span>
      <span>
        <kbd className="kbd">⌘K</kbd> focus input
      </span>
      <span>
        <kbd className="kbd">⌘⇧C</kbd> copy result
      </span>
      <span>
        <kbd className="kbd">Esc</kbd> clear
      </span>
    </div>
  )
}

function getMainText(r: LiveResult | null): string | null {
  if (!r) return null
  if (r.intent === 'sentence') return r.partial.main ?? null
  return r.partial.primaryTranslation ?? null
}
