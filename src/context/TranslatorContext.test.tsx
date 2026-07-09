// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslatorProvider, useTranslatorContext } from './TranslatorContext'
import { UiLangProvider } from '../hooks/useUiLang'

// Regression test for Critical 1: the safety-net flip must not cascade back
// through the pre-flight heuristic. Sequence under test (verified on HEAD
// before the fix): target='fr', user types 'merci beaucoup'. tinyld reports
// low confidence -> rawDetected falls back to 'en' -> no pre-flight flip ->
// request runs auto->fr. Model reports sourceLang='fr' === target -> safety
// net fires setTarget('en'). On the very next render, without the fix,
// rawDetected('en') === the freshly-corrected target('en') so
// resolveTranslationTarget flips AGAIN to 'ko', and the auto-swap effect
// persists it. The fix (routing the heuristic through `flipGuardRef`) must
// stop this second flip.
//
// useTranslate is mocked so the test controls exactly when/what the "model"
// reports, without touching the network. detectLanguage is mocked to
// deterministically reproduce the low-confidence-English-fallback heuristic
// without depending on tinyld's exact scoring for a given sentence.

vi.mock('../lib/detectLanguage', () => ({
  detectLanguage: () => 'en',
}))

vi.mock('../hooks/useTranslate', async () => {
  const React = await import('react')

  let currentLive: unknown = null
  const listeners = new Set<(v: unknown) => void>()

  function applyMockLive(v: unknown) {
    currentLive = v
    listeners.forEach((fn) => fn(v))
  }

  function useTranslate() {
    const [live, setLive] = React.useState(currentLive)
    React.useEffect(() => {
      listeners.add(setLive)
      return () => {
        listeners.delete(setLive)
      }
    }, [])
    return {
      live,
      isPending: false,
      streaming: false,
      error: null,
      run: () => Promise.resolve(),
      reset: () => {},
      flush: () => false,
      queueImmediate: () => {},
      restore: (v: unknown) => applyMockLive(v),
    }
  }

  return { useTranslate, __setMockLive: applyMockLive }
})

async function setMockLive(v: unknown) {
  const mod = (await import('../hooks/useTranslate')) as unknown as {
    __setMockLive: (v: unknown) => void
  }
  act(() => {
    mod.__setMockLive(v)
  })
}

function Consumer({
  capture,
}: {
  capture: (ctx: ReturnType<typeof useTranslatorContext>) => void
}) {
  const ctx = useTranslatorContext()
  capture(ctx)
  return <div data-testid="target">{ctx.target}</div>
}

describe('TranslatorContext safety-net flip (Critical 1 regression)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // jsdom doesn't implement matchMedia; TranslatorProvider's focus-on-mount
    // effect calls it unconditionally.
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('does not cascade the safety-net flip back through the pre-flight heuristic', async () => {
    window.localStorage.setItem('nt.target', JSON.stringify('fr'))
    window.localStorage.setItem('nt.source', JSON.stringify('auto'))

    const holder: { current: ReturnType<typeof useTranslatorContext> | null } =
      { current: null }
    const capture = (c: ReturnType<typeof useTranslatorContext>) => {
      holder.current = c
    }

    const { rerender } = render(
      <UiLangProvider>
        <TranslatorProvider>
          <Consumer capture={capture} />
        </TranslatorProvider>
      </UiLangProvider>,
    )

    await waitFor(() => expect(holder.current?.target).toBe('fr'))

    act(() => {
      holder.current?.setInput('merci beaucoup')
    })
    await waitFor(() => expect(holder.current?.input).toBe('merci beaucoup'))

    // Pre-flight: low-confidence heuristic fallback must NOT flip the target
    // away from 'fr' before the request even runs.
    expect(holder.current?.target).toBe('fr')

    // Model reports back: sourceLang === current target ('fr') -> safety net
    // fires once, flipping the target to 'en'.
    await setMockLive({
      intent: 'sentence',
      partial: { sourceLang: 'fr' },
      done: true,
      meta: null,
      text: 'merci beaucoup',
    })

    await waitFor(() => expect(holder.current?.target).toBe('en'))

    // Force another render pass off the same (now stale-relative-to-nothing)
    // live value. Without the fix, the heuristic's 'en' fallback would read
    // as matching the freshly-corrected target and flip again to 'ko'.
    rerender(
      <UiLangProvider>
        <TranslatorProvider>
          <Consumer capture={capture} />
        </TranslatorProvider>
      </UiLangProvider>,
    )

    expect(holder.current?.target).toBe('en')

    // Whitespace regression (W1): the flip guard stored the RAW input
    // ('merci beaucoup') while the resolver and freshness gates compare
    // against the TRIMMED input. Appending a trailing space changes the raw
    // input without changing the trimmed input, so an unfixed guard stops
    // matching, rawDetected('en') is fed back into the resolver, and it
    // reads as matching the just-corrected target('en') -> flips to 'ko'.
    // The guard must be keyed on trimmed input so it still matches here.
    act(() => {
      holder.current?.setInput('merci beaucoup ')
    })
    await waitFor(() => expect(holder.current?.input).toBe('merci beaucoup '))

    expect(holder.current?.target).toBe('en')
  })
})

describe('refine + context state', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  function setup() {
    const holder: { current: ReturnType<typeof useTranslatorContext> | null } =
      { current: null }
    render(
      <UiLangProvider>
        <TranslatorProvider>
          <Consumer capture={(c) => (holder.current = c)} />
        </TranslatorProvider>
      </UiLangProvider>,
    )
    return holder
  }

  async function completeSentence(
    holder: ReturnType<typeof setup>,
    text: string,
    main: string,
  ) {
    act(() => holder.current!.setInput(text))
    await waitFor(() => expect(holder.current?.input).toBe(text))
    await setMockLive({
      intent: 'sentence',
      partial: { main },
      done: true,
      meta: null,
      text,
    })
  }

  it('addRefinement stacks, dedupes, and caps at 5', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')
    act(() => holder.current!.addRefinement('make it softer'))
    act(() => holder.current!.addRefinement('make it softer')) // duplicate
    expect(holder.current?.refinements).toEqual(['make it softer'])
    act(() => {
      for (const r of ['a', 'b', 'c', 'd', 'e', 'f'])
        holder.current!.addRefinement(r)
    })
    expect(holder.current?.refinements).toHaveLength(5)
  })

  it('editing the input text clears refinements and the undo stack; context survives', async () => {
    const holder = setup()
    act(() => holder.current!.setContext('회의 몇 시에 해요?'))
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')
    act(() => holder.current!.addRefinement('make it softer'))
    expect(holder.current?.refinements).toEqual(['make it softer'])
    expect(holder.current?.canUndo).toBe(true)

    act(() => holder.current!.setInput('a different sentence'))
    expect(holder.current?.refinements).toEqual([])
    expect(holder.current?.canUndo).toBe(false)
    expect(holder.current?.context).toBe('회의 몇 시에 해요?')
  })

  it('mode change keeps refinements', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')
    act(() => holder.current!.addRefinement('make it softer'))
    act(() => holder.current!.setMode('friends'))
    expect(holder.current?.refinements).toEqual(['make it softer'])
  })

  it('undoRefine restores the previous result and refinement list', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')
    act(() => holder.current!.addRefinement('make it softer'))
    // simulate the refined run completing
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요~' },
      done: true,
      meta: null,
      text: 'see you tomorrow',
    })
    act(() => holder.current!.undoRefine())
    expect(holder.current?.refinements).toEqual([])
    expect(holder.current?.canUndo).toBe(false)
    await waitFor(() =>
      expect(
        (holder.current?.live?.partial as { main?: string } | undefined)?.main,
      ).toBe('내일 봐요'),
    )
  })
})
