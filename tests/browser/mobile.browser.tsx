import { startTransition, useRef, useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import InputPanel from '../../src/components/InputPanel'
import OutputPanel from '../../src/components/OutputPanel'
import { useTranslatorContext } from '../../src/context/TranslatorContext'
import { UiLangProvider } from '../../src/hooks/useUiLang'
import type { LiveResult } from '../../src/hooks/useTranslate'
import { speak } from '../../src/server/speech'
import { SyntheticAudioContext } from './syntheticAudio'

vi.mock('../../src/context/TranslatorContext', () => ({
  useTranslatorContext: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('../../src/server/speech', () => ({ speak: vi.fn() }))

const sourceText = 'Thanks for helping me today.'
const learningTips = {
  grammar: 'The polite ending makes this suitable for a friendly colleague.',
  vocab: '도와주다 means to help someone.',
  characters: [],
}
const sentence: LiveResult = {
  intent: 'sentence',
  text: sourceText,
  requestSource: 'en',
  done: true,
  partial: {
    sourceLang: 'en',
    targetLang: 'ko',
    main: '오늘 도와줘서 고마워요.',
    rationale: 'A warm and natural thank you.',
    alternatives: [],
    formalityNote: '',
    learningTips,
  },
}
const word: LiveResult = {
  intent: 'word',
  text: 'library',
  requestSource: 'en',
  done: true,
  partial: {
    sourceLang: 'en',
    targetLang: 'ko',
    headword: 'library',
    primaryTranslation: '도서관',
    primaryUsageNote: '',
    alternativeTranslations: [
      { text: '도서실', register: [], note: 'A reading room.' },
    ],
    posList: [],
    synonyms: [],
    etymology: '',
    notes: '',
    learningTips,
  },
}

type Context = ReturnType<typeof useTranslatorContext>
type State = Pick<
  Context,
  'input' | 'source' | 'target' | 'live' | 'context' | 'isPending' | 'streaming'
>
let update: (patch: Partial<State>) => void
let updateUrgent: (patch: Partial<State>) => void

function Fixture({ initial = sentence }: { initial?: LiveResult }) {
  const [state, setState] = useState<State>({
    input: initial.text,
    source: 'en',
    target: 'ko',
    live: initial,
    context: '',
    isPending: false,
    streaming: false,
  })
  update = (patch) =>
    startTransition(() => setState((old) => ({ ...old, ...patch })))
  updateUrgent = (patch) => setState((old) => ({ ...old, ...patch }))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const context: Context = {
    ...state,
    mode: 'casual',
    intent: state.live?.intent ?? 'sentence',
    isPolish: false,
    detected: null,
    error: null,
    refineError: null,
    refinements: [],
    outputTips: state.live?.partial.learningTips,
    textareaRef,
    setInput: (input) => setState((old) => ({ ...old, input })),
    setSource: (source) => setState((old) => ({ ...old, source })),
    setTarget: (target) => setState((old) => ({ ...old, target })),
    setContext: (nextContext) =>
      setState((old) => ({ ...old, context: nextContext })),
    clearInput: () => setState((old) => ({ ...old, input: '', live: null })),
    setMode: vi.fn(),
    run: vi.fn(),
    reset: vi.fn(),
    flush: () => false,
    queueImmediate: vi.fn(),
    lookupWord: vi.fn(),
    addRefinement: vi.fn(),
    removeRefinement: vi.fn(),
  }
  vi.mocked(useTranslatorContext).mockReturnValue(context)
  return (
    <UiLangProvider>
      <main className="app-shell flex min-h-[100dvh] flex-col">
        <div className="translator-panels relative flex flex-1 flex-col">
          <InputPanel />
          <OutputPanel />
        </div>
      </main>
    </UiLangProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  SyntheticAudioContext.instances = []
  vi.stubGlobal('AudioContext', SyntheticAudioContext)
  vi.mocked(speak).mockImplementation(
    async () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'audio',
            audio: new Uint8Array(480),
            sampleRate: 24000,
          })
          controller.enqueue({ type: 'done' })
          controller.close()
        },
      }),
  )
})

function assertWithinViewport(element: Element) {
  const rect = element.getBoundingClientRect()
  expect(rect.left).toBeGreaterThanOrEqual(-1)
  expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 1)
  expect(rect.top).toBeGreaterThanOrEqual(-1)
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
}

test('all source and target actions stay on one line at the mobile viewport', async () => {
  await render(<Fixture />)
  await expect
    .element(page.getByTestId('output-toolbar').getByTestId('listen-button'))
    .toBeVisible()
  await page.mark('completed result shows every mobile toolbar action')
  for (const selector of ['.input-panel', '.output-panel']) {
    const panel = document.querySelector(selector)!
    const toolbar = panel.firstElementChild!
    const buttons = [...toolbar.querySelectorAll('button')].filter(
      (button) => button.getBoundingClientRect().width > 0,
    )
    expect(buttons.length).toBeGreaterThanOrEqual(5)
    const tops = buttons.map((button) => button.getBoundingClientRect().top)
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2)
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
      expect(
        button.getAttribute('aria-label') || button.textContent.trim(),
      ).toBeTruthy()
    }
  }
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  )
})

test('language menus stay within the viewport and support keyboard selection', async () => {
  await render(<Fixture />)
  for (const name of ['Source language', 'Target language']) {
    const trigger = page
      .getByRole('group', { name })
      .getByTestId('lang-more-trigger')
    await page.mark(`open ${name} menu`, async () => {
      await trigger.click()
    })
    await expect.element(page.getByRole('listbox')).toBeVisible()
    assertWithinViewport(page.getByRole('listbox').element())
    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await userEvent.keyboard('j{Enter}')
    await expect
      .element(
        page
          .getByRole('group', { name })
          .getByRole('button', { name: '日本語' }),
      )
      .toHaveAttribute('aria-pressed', 'true')
    await page.mark(`${name} Japanese selection is visible`)
  }
})

test('context and learner popup remain usable in a short mobile viewport', async () => {
  await render(<Fixture />)
  await page.mark('open replying context', async () => {
    await page.getByTestId('context-toggle').click()
  })
  await page
    .getByTestId('context-textarea')
    .fill('A friendly colleague helped with a deadline.')
  await expect
    .element(page.getByTestId('context-toggle'))
    .toHaveAttribute('aria-expanded', 'true')
  await page.getByTestId('context-clear').click()
  await expect.element(page.getByTestId('context-textarea')).toHaveValue('')
  await page.getByTestId('context-toggle').click()
  await page.getByRole('button', { name: 'Learning tips' }).click()
  const popup = page.getByRole('dialog')
  await expect.element(popup).toBeVisible()
  assertWithinViewport(popup.element())
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('button', { name: 'Learning tips' }))
    .toHaveAttribute('aria-expanded', 'false')
})

test('Listen stops explicitly, completes after audio ends, and replays without a new request', async () => {
  await render(<Fixture />)
  const listen = page.getByTestId('output-toolbar').getByTestId('listen-button')
  expect(speak).not.toHaveBeenCalled()
  await page.mark('first explicit Listen', async () => {
    await listen.click()
  })
  await expect.element(listen).toHaveAccessibleName(/stop/i)
  await page.mark('explicit Stop', async () => {
    await listen.click()
  })
  await expect.element(listen).toHaveAccessibleName(/listen/i)
  expect(SyntheticAudioContext.instances[0]?.closed).toBe(true)
  await listen.click()
  await expect.element(listen).toHaveAccessibleName(/stop/i)
  await page.mark('network ended but scheduled audio is still playing')
  await page.mark('final PCM source ended', () => {
    SyntheticAudioContext.instances.at(-1)!.finish()
  })
  await expect.element(listen).toHaveAccessibleName(/listen/i)
  const requests = vi.mocked(speak).mock.calls.length
  await page.mark('replay completed audio', async () => {
    await listen.click()
  })
  await expect.element(listen).toHaveAccessibleName(/stop/i)
  expect(speak).toHaveBeenCalledTimes(requests)
  SyntheticAudioContext.instances.at(-1)!.finish()
  await expect.element(listen).toHaveAccessibleName(/listen/i)
})

test('editing input cancels playback and switching sentence to word resets the result', async () => {
  await render(<Fixture />)
  const listen = page.getByTestId('output-toolbar').getByTestId('listen-button')
  await listen.click()
  await expect.element(listen).toHaveAccessibleName(/stop/i)
  await page.mark('edit source while speech plays', async () => {
    await page.getByTestId('input-textarea').fill('Another sentence.')
  })
  await expect.element(listen).toBeDisabled()
  expect(SyntheticAudioContext.instances.at(-1)?.closed).toBe(true)
  await page.mark('new dictionary result replaces sentence', () => {
    update({ input: 'library', live: word })
  })
  await expect.element(page.getByText('도서관', { exact: true })).toBeVisible()
  await expect.element(listen).toBeEnabled()
  await expect
    .element(page.getByTestId('refine-chip-softer'))
    .not.toBeInTheDocument()
  await listen.click()
  await expect.element(listen).toHaveAccessibleName(/stop/i)
  await page.mark('new pending result cancels speech', () => {
    update({ isPending: true, streaming: true, live: { ...word, done: false } })
  })
  await expect.element(listen).not.toBeInTheDocument()
  await expect
    .poll(() => SyntheticAudioContext.instances.at(-1)?.closed)
    .toBe(true)
})

test('changing the target language aborts a connecting speech request', async () => {
  let requestSignal: AbortSignal | undefined
  vi.mocked(speak).mockImplementation(({ signal }) => {
    requestSignal = signal
    return new Promise(() => {})
  })
  await render(
    <Fixture
      initial={{
        ...sentence,
        partial: { ...sentence.partial, main: '연결 취소를 확인해요.' },
      }}
    />,
  )
  const listen = page.getByTestId('output-toolbar').getByTestId('listen-button')
  await page.mark('Listen starts a connecting request', async () => {
    await listen.click()
  })
  await expect.element(listen).toHaveAttribute('aria-busy', 'true')
  await expect.poll(() => requestSignal !== undefined).toBe(true)
  await page
    .getByRole('group', { name: 'Target language' })
    .getByTestId('lang-more-trigger')
    .click()
  await page.mark('target language change cancels request', async () => {
    await page.getByRole('option', { name: 'Français' }).click()
  })
  await expect.poll(() => requestSignal?.aborted).toBe(true)
  await expect.element(listen).toHaveAttribute('aria-pressed', 'false')
  expect(SyntheticAudioContext.instances.at(-1)?.closed).toBe(true)
})

test('streaming deltas stay urgent and only completion starts a result transition', async () => {
  const partial: LiveResult = {
    ...sentence,
    done: false,
    partial: { ...sentence.partial, main: '오늘' },
  }
  await render(<Fixture initial={partial} />)
  const transition = vi.spyOn(document, 'startViewTransition')
  await page.mark('urgent partial translation delta', () => {
    updateUrgent({
      live: {
        ...partial,
        partial: { ...partial.partial, main: '오늘 도와줘서' },
      },
      isPending: true,
      streaming: true,
    })
  })
  await expect
    .element(page.getByText('오늘 도와줘서', { exact: true }))
    .toBeVisible()
  expect(transition).not.toHaveBeenCalled()
  await expect
    .element(page.getByTestId('output-toolbar').getByTestId('listen-button'))
    .not.toBeInTheDocument()
  await page.mark('completed translation commits in a transition', () => {
    update({ live: sentence, isPending: false, streaming: false })
  })
  await expect
    .element(page.getByTestId('output-toolbar').getByTestId('listen-button'))
    .toBeVisible()
  await expect.poll(() => transition.mock.calls.length).toBeGreaterThan(0)
  transition.mockRestore()
})

test('result switches honor the browser motion preference', async () => {
  await render(<Fixture />)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const transition = vi.spyOn(document, 'startViewTransition')
  await page.mark(
    `switch result with ${reduced ? 'reduced' : 'normal'} motion`,
    () => {
      update({ input: 'library', live: word })
    },
  )
  await expect.element(page.getByText('도서관', { exact: true })).toBeVisible()
  const animated = [...document.querySelectorAll('.animate-settle')]
  expect(animated.length).toBeGreaterThan(0)
  for (const element of animated)
    expect(getComputedStyle(element).animationName).toBe(
      reduced ? 'none' : 'settle-in',
    )
  await expect.poll(() => transition.mock.calls.length).toBeGreaterThan(0)
  const rules = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
    .join('\n')
  expect(rules).toContain('prefers-reduced-motion: reduce')
  expect(rules).toContain('::view-transition-new')
  transition.mockRestore()
})

test.each(['sentence', 'word'] as const)(
  'pronounces %s alternatives without overlapping the main voice',
  async (intent) => {
    const initial: LiveResult =
      intent === 'sentence'
        ? {
            ...sentence,
            partial: {
              ...sentence.partial,
              alternatives: [
                { text: '정말 고마워요.', note: 'A warmer thank you.' },
              ],
            },
          }
        : word
    await render(<Fixture initial={initial} />)
    const main = page.getByTestId('output-toolbar').getByTestId('listen-button')
    const row = page.getByTestId('alternative-item')
    const alternative = row.getByTestId('listen-button')
    await expect.element(alternative).toBeVisible()
    const rowBounds = row.element().getBoundingClientRect()
    for (const button of row.element().querySelectorAll('button')) {
      const rect = button.getBoundingClientRect()
      expect(rect.left).toBeGreaterThanOrEqual(rowBounds.left)
      expect(rect.right).toBeLessThanOrEqual(rowBounds.right)
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    )
    await main.click()
    await expect.element(main).toHaveAccessibleName(/stop/i)
    await page.mark('alternative takes over pronunciation', async () => {
      await alternative.click()
    })
    await expect.element(main).toHaveAccessibleName(/listen/i)
    await expect.element(alternative).toHaveAccessibleName(/stop/i)
    expect(SyntheticAudioContext.instances[0]?.closed).toBe(true)
    expect(vi.mocked(speak).mock.calls.at(-1)![0].data).toMatchObject({
      text: intent === 'sentence' ? '정말 고마워요.' : '도서실',
      language: 'ko',
    })
    SyntheticAudioContext.instances.at(-1)!.finish()
    await expect.element(alternative).toHaveAccessibleName(/listen/i)
    const requests = vi.mocked(speak).mock.calls.length
    await alternative.click()
    await expect.element(alternative).toHaveAccessibleName(/stop/i)
    expect(speak).toHaveBeenCalledTimes(requests)
    await page.getByTestId('input-textarea').fill('Updated source')
    await expect.element(alternative).toBeDisabled()
    expect(SyntheticAudioContext.instances.at(-1)?.closed).toBe(true)
  },
)
