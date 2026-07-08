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
  })
})
