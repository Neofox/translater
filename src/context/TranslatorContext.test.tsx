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
  const liveListeners = new Set<(v: unknown) => void>()
  let currentError: unknown = null
  const errorListeners = new Set<(v: unknown) => void>()
  const calls: Array<{ source: string; target: string; text: string }> = []
  let onSourceDetected: ((report: unknown) => void) | undefined

  function applyMockLive(v: unknown) {
    currentLive = v
    liveListeners.forEach((fn) => fn(v))
  }

  function applyMockError(v: unknown) {
    currentError = v
    errorListeners.forEach((fn) => fn(v))
  }

  function useTranslate(
    args: { source: string; target: string; text: string },
    options?: { onSourceDetected?: (report: unknown) => void },
  ) {
    calls.push(args)
    onSourceDetected = options?.onSourceDetected
    const [live, setLive] = React.useState(currentLive)
    React.useEffect(() => {
      liveListeners.add(setLive)
      return () => {
        liveListeners.delete(setLive)
      }
    }, [])
    const [error, setError] = React.useState(currentError)
    React.useEffect(() => {
      errorListeners.add(setError)
      return () => {
        errorListeners.delete(setError)
      }
    }, [])
    return {
      live,
      isPending: false,
      streaming: false,
      error,
      run: () => Promise.resolve(),
      reset: () => {},
      flush: () => false,
      queueImmediate: () => {},
      restore: (v: unknown) => {
        applyMockError(null)
        applyMockLive(v)
      },
    }
  }

  return {
    useTranslate,
    __setMockLive: applyMockLive,
    __setMockError: applyMockError,
    __reportSource: (report: unknown) => onSourceDetected?.(report),
    __getCalls: () => calls,
    __clearCalls: () => {
      calls.length = 0
    },
  }
})

async function setMockLive(v: unknown) {
  const mod = (await import('../hooks/useTranslate')) as unknown as {
    __setMockLive: (v: unknown) => void
  }
  act(() => {
    mod.__setMockLive(v)
  })
}

async function setMockError(v: unknown) {
  const mod = (await import('../hooks/useTranslate')) as unknown as {
    __setMockError: (v: unknown) => void
  }
  act(() => {
    mod.__setMockError(v)
  })
}

type SourceReport = {
  text: string
  requestSource: 'auto' | 'fr'
  sourceLang: 'en' | 'fr'
}

async function mockControls() {
  const mod = (await import('../hooks/useTranslate')) as unknown as {
    __reportSource: (report: SourceReport) => void
    __setMockLive: (v: unknown) => void
    __getCalls: () => Array<{ source: string; target: string; text: string }>
    __clearCalls: () => void
  }
  return mod
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

describe('TranslatorContext source detection routing', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    // jsdom doesn't implement matchMedia; TranslatorProvider's focus-on-mount
    // effect calls it unconditionally.
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
    await setMockLive(null)
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  function setup(source: 'auto' | 'fr' = 'auto', target = 'ko') {
    window.localStorage.setItem('nt.target', JSON.stringify(target))
    window.localStorage.setItem('nt.source', JSON.stringify(source))
    const holder: { current: ReturnType<typeof useTranslatorContext> | null } =
      {
        current: null,
      }
    render(
      <UiLangProvider>
        <TranslatorProvider>
          <Consumer capture={(c) => (holder.current = c)} />
        </TranslatorProvider>
      </UiLangProvider>,
    )
    return holder
  }

  async function reportSource(text: string, sourceLang: 'en' | 'fr') {
    const controls = await mockControls()
    act(() => {
      controls.__reportSource({ text, requestSource: 'auto', sourceLang })
      controls.__setMockLive({
        intent: 'sentence',
        partial: { sourceLang },
        done: true,
        requestSource: 'auto',
        text,
      })
    })
  }

  async function setInput(holder: ReturnType<typeof setup>, text: string) {
    act(() => {
      holder.current?.setInput(text)
    })
    await waitFor(() => expect(holder.current?.input).toBe(text))
  }

  it('keeps English selected after a current French model report', async () => {
    const holder = setup()
    await setInput(holder, 'merci beaucoup')
    await reportSource('merci beaucoup', 'fr')
    await waitFor(() => expect(holder.current?.detected).toBe('fr'))

    act(() => holder.current?.setTarget('en'))

    await waitFor(() => expect(holder.current?.target).toBe('en'))
  })

  it('keeps an explicit English selection during the synchronous report/live race', async () => {
    const holder = setup()
    await setInput(holder, 'merci beaucoup')
    const controls = await mockControls()
    controls.__clearCalls()

    act(() => {
      controls.__reportSource({
        text: 'merci beaucoup',
        requestSource: 'auto',
        sourceLang: 'fr',
      })
      controls.__setMockLive({
        intent: 'sentence',
        partial: { sourceLang: 'fr' },
        done: false,
        requestSource: 'auto',
        text: 'merci beaucoup',
      })
      holder.current?.setTarget('en')
    })

    await waitFor(() => expect(holder.current?.target).toBe('en'))
    expect(controls.__getCalls().every((call) => call.target !== 'ko')).toBe(
      true,
    )
  })

  it('falls back away from the authoritative French source', async () => {
    const holder = setup()
    await setInput(holder, 'merci beaucoup')
    await reportSource('merci beaucoup', 'fr')
    await waitFor(() => expect(holder.current?.detected).toBe('fr'))

    act(() => holder.current?.setTarget('fr'))

    await waitFor(() => expect(holder.current?.target).toBe('en'))
  })

  it('ignores a model report retained for a different input', async () => {
    const holder = setup()
    await setInput(holder, 'merci beaucoup')
    await reportSource('merci beaucoup', 'fr')
    await waitFor(() => expect(holder.current?.detected).toBe('fr'))
    await setInput(holder, 'different input')

    act(() => holder.current?.setTarget('en'))

    await waitFor(() => expect(holder.current?.target).toBe('ko'))
  })

  it('allows a manual French source to target English', async () => {
    const holder = setup('fr')
    await setInput(holder, 'merci beaucoup')

    act(() => holder.current?.setTarget('en'))

    await waitFor(() => expect(holder.current?.target).toBe('en'))
  })

  it('does not retain a manual French polish report when switching to Auto', async () => {
    const holder = setup('fr', 'fr')
    await setInput(holder, 'merci beaucoup')
    await setMockLive({
      intent: 'sentence',
      partial: { sourceLang: 'fr' },
      done: true,
      requestSource: 'fr',
      text: 'merci beaucoup',
    })
    const controls = await mockControls()
    controls.__clearCalls()

    act(() => holder.current?.setSource('auto'))

    await waitFor(() => expect(holder.current?.source).toBe('auto'))
    expect(controls.__getCalls()[0]).toMatchObject({
      source: 'auto',
      target: 'fr',
      text: 'merci beaucoup',
    })
  })

  it('falls back when a current model report identifies English', async () => {
    const holder = setup()
    await setInput(holder, 'merci beaucoup')
    await reportSource('merci beaucoup', 'en')
    await waitFor(() => expect(holder.current?.detected).toBe('en'))

    act(() => holder.current?.setTarget('en'))

    await waitFor(() => expect(holder.current?.target).toBe('ko'))
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
      requestSource: 'auto',
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

  it('routes again after clearing and re-entering safety-flipped text', async () => {
    const holder = setup('auto', 'fr')
    const controls = await mockControls()
    const text = 'merci beaucoup'

    await setInput(holder, text)
    await setMockLive({
      intent: 'sentence',
      partial: { sourceLang: 'fr' },
      done: true,
      requestSource: 'auto',
      text,
    })

    await waitFor(() => expect(holder.current?.target).toBe('en'))
    controls.__clearCalls()

    await setInput(holder, '')
    await setInput(holder, text)

    await waitFor(() => expect(holder.current?.target).toBe('ko'))
    expect(controls.__getCalls()).toContainEqual(
      expect.objectContaining({
        source: 'auto',
        target: 'ko',
        text,
      }),
    )
  })
})

describe('refine + context state', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
    await setMockError(null)
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
      requestSource: 'auto',
      text,
    })
  }

  it('addRefinement stacks, dedupes, and caps at 3', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')
    act(() => holder.current!.addRefinement('make it softer'))
    act(() => holder.current!.addRefinement('make it softer')) // duplicate
    expect(holder.current?.refinements).toEqual(['make it softer'])
    act(() => {
      for (const r of ['a', 'b', 'c', 'd']) holder.current!.addRefinement(r)
    })
    expect(holder.current?.refinements).toHaveLength(3)
  })

  it('editing the input text clears refinements and the undo stack; context survives', async () => {
    const holder = setup()
    act(() => holder.current!.setContext('회의 몇 시에 해요?'))
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')
    act(() => holder.current!.addRefinement('make it softer'))
    expect(holder.current?.refinements).toEqual(['make it softer'])

    act(() => holder.current!.setInput('a different sentence'))
    expect(holder.current?.refinements).toEqual([])
    expect(holder.current?.context).toBe('회의 몇 시에 해요?')
  })

  it('mode change keeps refinements', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')
    act(() => holder.current!.addRefinement('make it softer'))
    act(() => holder.current!.setMode('friends'))
    expect(holder.current?.refinements).toEqual(['make it softer'])
  })

  it('removeRefinement drops only the targeted refinement and pushes an undo snapshot', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')

    act(() => holder.current!.addRefinement('make it softer'))
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 봐요~' },
      done: true,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })
    act(() => holder.current!.addRefinement('more formal'))
    await setMockLive({
      intent: 'sentence',
      partial: { main: '내일 뵙겠습니다' },
      done: true,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })
    expect(holder.current?.refinements).toEqual([
      'make it softer',
      'more formal',
    ])

    act(() => holder.current!.removeRefinement(0))

    expect(holder.current?.refinements).toEqual(['more formal'])
  })

  it('a server error while a refine is in flight rolls back to the pre-refine state', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')

    act(() => holder.current!.addRefinement('make it softer'))
    expect(holder.current?.refinements).toEqual(['make it softer'])

    // The refine's run rejects — TranslatorContext's rollback effect is
    // gated on `refineInFlightRef`, which is still set from addRefinement
    // above since no live update has landed yet.
    await setMockError({ kind: 'server', message: 'boom' })

    expect(holder.current?.refinements).toEqual([])
    // Per the amended design spec's State rules: a failed refine keeps the
    // previous result on screen (hook `error` is cleared by the rollback so
    // OutputPanel renders the restored result instead of the full-panel
    // ErrorView) and surfaces a compact inline failure notice via
    // `refineError` instead.
    expect(holder.current?.error).toBeNull()
    expect(holder.current?.refineError).not.toBeNull()
    expect(holder.current?.refineError?.message).toBe('boom')
    await waitFor(() =>
      expect(
        (holder.current?.live?.partial as { main?: string } | undefined)?.main,
      ).toBe('내일 봐요'),
    )
  })

  it('refineError does not linger past the next unrelated completed run', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')

    act(() => holder.current!.addRefinement('make it softer'))
    expect(holder.current?.refinements).toEqual(['make it softer'])

    // Mirrors what the real run() does the instant it starts: it immediately
    // replaces `live` with an in-progress (done:false) placeholder before
    // any network I/O — so by the time an error can land, `live` in state is
    // already a different object from the pre-refine snapshot. Without this
    // step the mock would never actually change `live` object identity
    // during the rollback below, which isn't representative of production.
    await setMockLive({
      intent: 'sentence',
      partial: {},
      done: false,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })

    // Refine fails and rolls back — refineError is set alongside the
    // restored snapshot (mirrors the existing rollback test above).
    await setMockError({ kind: 'server', message: 'boom' })
    expect(holder.current?.refineError).not.toBeNull()

    // Clear the mock error channel so it doesn't re-trigger the rollback
    // effect, then simulate a later, entirely unrelated run completing
    // (e.g. a tone-mode change, language change, or context edit) for the
    // SAME input text. Before the fix this landed with
    // `refineInFlightRef.current` false and left the stale notice up.
    await setMockError(null)
    await setMockLive({
      intent: 'sentence',
      partial: { main: '새 결과' },
      done: true,
      requestSource: 'auto',
      text: 'see you tomorrow',
    })

    expect(holder.current?.refineError).toBeNull()
  })

  it('refineError clears on the next refine action', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')

    act(() => holder.current!.addRefinement('make it softer'))
    await setMockError({ kind: 'server', message: 'boom' })
    expect(holder.current?.refineError).not.toBeNull()

    act(() => holder.current!.addRefinement('make it shorter'))
    expect(holder.current?.refineError).toBeNull()
  })

  it('addRefinement is a no-op while live is stale relative to the current input', async () => {
    const holder = setup()
    await completeSentence(holder, 'text A', '결과 A')

    // Edit the input before any new live result arrives. The reset already
    // clears refinements/undo here, but that's not what this test pins down
    // — it pins the guard that must ALSO reject the action outright for the
    // window where `live` (still produced for "text A") is stale relative to
    // the now-current input ("text B").
    act(() => holder.current!.setInput('text B'))
    expect(holder.current?.refinements).toEqual([])

    act(() => holder.current!.addRefinement('make it softer'))

    expect(holder.current?.refinements).toEqual([])
  })

  it('a server error with no refine in flight leaves refinements and the result untouched', async () => {
    const holder = setup()
    await completeSentence(holder, 'see you tomorrow', '내일 봐요')
    expect(holder.current?.refinements).toEqual([])

    await setMockError({ kind: 'server', message: 'boom' })

    expect(holder.current?.refinements).toEqual([])
    expect(holder.current?.refineError).toBeNull()
    await waitFor(() =>
      expect(
        (holder.current?.live?.partial as { main?: string } | undefined)?.main,
      ).toBe('내일 봐요'),
    )
  })
})
