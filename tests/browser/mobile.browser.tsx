import { startTransition, useRef, useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import TranslatorWorkspace from '../../src/components/TranslatorWorkspace'
import { useTranslatorContext } from '../../src/context/TranslatorContext'
import { UiLangProvider } from '../../src/hooks/useUiLang'
import type { LiveResult } from '../../src/hooks/useTranslate'
import { speak } from '../../src/server/speech'
import { translationRequestKey } from '../../src/lib/translationRequestKey'
import { SyntheticAudioContext } from './syntheticAudio'

vi.mock('../../src/context/TranslatorContext', () => ({
  useTranslatorContext: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('../../src/server/speech', () => ({ speak: vi.fn() }))

const requestKey = (text: string) =>
  translationRequestKey({
    text,
    source: 'en',
    target: 'ko',
    mode: 'casual',
    context: '',
    refinements: [],
    uiLang: 'en',
  })

const sourceText = 'Thanks for helping me today.'
const learningTips = {
  grammar: 'The polite ending makes this suitable for a friendly colleague.',
  vocab: '도와주다 means to help someone.',
  characters: [],
}
const sentence: LiveResult = {
  intent: 'sentence',
  text: sourceText,
  requestKey: requestKey(sourceText),
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
  requestKey: requestKey('library'),
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
    posList: [
      {
        pos: 'noun',
        senses: [
          {
            definition:
              'A place where books are kept for reading and borrowing.',
            register: [],
            examples: ['The library opens at nine.'],
          },
        ],
      },
    ],
    synonyms: ['reading room'],
    etymology: 'From Latin librarium.',
    notes: '',
    learningTips,
  },
}

type Context = ReturnType<typeof useTranslatorContext>
type State = Pick<
  Context,
  | 'input'
  | 'source'
  | 'target'
  | 'live'
  | 'context'
  | 'isPending'
  | 'streaming'
  | 'error'
>
let update: (patch: Partial<State>) => void
let updateUrgent: (patch: Partial<State>) => void

function Fixture({
  initial = sentence,
  initialSource = 'en',
  initialTarget = 'ko',
  initialMode = 'casual',
  initialDetected = null,
  initialError = null,
}: {
  initial?: LiveResult
  initialSource?: Context['source']
  initialTarget?: Context['target']
  initialMode?: Context['mode']
  initialDetected?: Context['detected']
  initialError?: Context['error']
}) {
  const [state, setState] = useState<State>({
    input: initial.text,
    source: initialSource,
    target: initialTarget,
    live: initial,
    context: '',
    isPending: false,
    streaming: false,
    error: initialError,
  })
  update = (patch) =>
    startTransition(() => setState((old) => ({ ...old, ...patch })))
  updateUrgent = (patch) => setState((old) => ({ ...old, ...patch }))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const context: Context = {
    ...state,
    mode: initialMode,
    intent: state.live?.intent ?? 'sentence',
    isPolish: false,
    detected: initialDetected,
    refineError: null,
    refinements: [],
    outputTips: state.live?.partial.learningTips,
    textareaRef,
    setInput: (input) => setState((old) => ({ ...old, input })),
    setSource: (source) => setState((old) => ({ ...old, source })),
    setTarget: (target) => setState((old) => ({ ...old, target })),
    setContext: (nextContext) =>
      setState((old) => ({ ...old, context: nextContext })),
    clearInput: () => {
      setState((old) => ({ ...old, input: '', live: null }))
      textareaRef.current?.focus()
    },
    setMode: vi.fn(),
    run: vi.fn(),
    reset: vi.fn(),
    flush: () => false,
    queueImmediate: vi.fn(),
    lookupWord: (text) =>
      setState((old) => ({ ...old, input: text, live: null })),
    addRefinement: vi.fn(),
    removeRefinement: vi.fn(),
  }
  vi.mocked(useTranslatorContext).mockReturnValue(context)
  return (
    <UiLangProvider>
      <TranslatorWorkspace />
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

test('Paste Clear and the main result actions remain visible and touch sized', async () => {
  await render(<Fixture />)
  await expect
    .element(page.getByTestId('output-toolbar').getByTestId('listen-button'))
    .toBeVisible()
  for (const element of [
    page.getByTestId('paste-input').element(),
    page.getByTestId('clear-input').element(),
    page
      .getByTestId('output-toolbar')
      .getByRole('button', { name: 'Copy', exact: true })
      .element(),
  ]) {
    assertWithinViewport(element)
    expect(element.getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
    expect(element.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  }
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  )
  await page.screenshot({
    path: `../../test-results/design-${window.innerWidth}x${window.innerHeight}-short.png`,
  })
})

test('language menus stay within the viewport and support keyboard selection', async () => {
  await render(<Fixture />)
  for (const name of ['Source language', 'Target language']) {
    const trigger = page
      .getByRole('group', { name })
      .getByTestId('lang-more-trigger')
    if (!trigger.query()?.checkVisibility()) continue
    await page.mark(`open ${name} menu`, async () => {
      await trigger.click()
    })
    await expect.element(page.getByRole('listbox')).toBeVisible()
    assertWithinViewport(page.getByRole('listbox').element())
    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await userEvent.keyboard('f{Enter}')
    await expect
      .element(
        page
          .getByRole('group', { name })
          .getByRole('button', { name: 'Français' }),
      )
      .toHaveAttribute('aria-pressed', 'true')
    await page.mark(`${name} French selection is visible`)
  }
})

test('context and learner details remain usable without a popup', async () => {
  await render(<Fixture />)
  await page.getByTestId('context-toggle').click()
  await page
    .getByTestId('context-textarea')
    .fill('A friendly colleague helped with a deadline.')
  await expect
    .element(page.getByTestId('context-toggle'))
    .toHaveAttribute('aria-expanded', 'true')
  await page.getByTestId('context-clear').click()
  await expect.element(page.getByTestId('context-textarea')).toHaveValue('')
  await page.getByTestId('context-toggle').click()
  const desktop = Boolean(
    document.querySelector('.translator-panels[data-desktop]'),
  )
  if (!desktop)
    await page
      .getByRole('button', { name: 'Learning tips', exact: true })
      .click()
  await expect
    .element(page.getByText(learningTips.grammar, { exact: true }))
    .toBeVisible()
  if (!desktop) {
    await page
      .getByRole('button', { name: 'Learning tips', exact: true })
      .click()
    await expect
      .element(page.getByRole('button', { name: 'Learning tips', exact: true }))
      .toHaveAttribute('aria-expanded', 'false')
  }
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
    if (!document.querySelector('.translator-panels[data-desktop]'))
      await page
        .getByRole('button', {
          name:
            intent === 'sentence' ? 'Alternatives' : 'Alternative translations',
          exact: true,
        })
        .click()
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

const longSource =
  'Thanks again for helping me settle into Seoul.\n\nI have been trying to practice Korean every day, but I still get nervous when conversations move quickly. If you are free this weekend, would you like to grab coffee and take a walk? There is no rush to decide; just let me know what works best for you.'
const longTranslation =
  '서울에 적응할 수 있게 도와줘서 다시 한번 고마워.\n\n매일 한국어를 연습하려고 하는데, 대화가 빨라지면 아직도 긴장돼. 이번 주말에 시간 괜찮으면 커피 마시고 산책할래? 바로 정할 필요는 없으니까, 언제가 편한지 알려줘.'
const withAlternatives: LiveResult = {
  ...sentence,
  partial: {
    ...sentence.partial,
    rationale: 'Natural wording for a friendly conversation.',
    formalityNote: 'A polite ending for a colleague.',
    alternatives: [
      { text: '정말 고마워요.', note: 'A warmer thank you.' },
      { text: '도움이 많이 됐어요.', note: 'Emphasizes how helpful it was.' },
    ],
  },
}

test('desktop notes stay open and short alternatives fit without scrolling', async () => {
  if (window.innerWidth < 1100 || window.innerHeight < 640) return
  await render(<Fixture initial={withAlternatives} />)
  await expect
    .element(
      page.getByRole('heading', { name: /^Why this wording/, exact: true }),
    )
    .toBeVisible()
  expect(
    page
      .getByRole('button', { name: /^Why this wording/, exact: true })
      .query(),
  ).toBeNull()
  await expect
    .element(page.getByText(learningTips.grammar, { exact: true }))
    .toBeVisible()
  for (const row of document.querySelectorAll(
    '[data-testid="alternative-item"]',
  ))
    assertWithinViewport(row)
  await Promise.all(
    [...document.getAnimations()].map((animation) =>
      animation.finished.catch(() => {}),
    ),
  )
  await page.screenshot({
    path: `../../test-results/design-${window.innerWidth}x${window.innerHeight}-alternatives.png`,
  })
})

test('long text uses both learner columns and the result has no focus ring', async () => {
  const initial: LiveResult = {
    ...sentence,
    text: longSource,
    requestKey: requestKey(longSource),
    partial: {
      ...sentence.partial,
      main: longTranslation,
      rationale: 'A low-pressure invitation.',
      formalityNote: 'Casual wording for a friend.',
    },
  }
  await render(<Fixture initial={initial} />)
  expect(longSource.length).toBe(300)
  await expect
    .element(page.getByText(longTranslation, { exact: true }))
    .toBeVisible()
  const output = page.getByTestId('translation-result').element() as HTMLElement
  output.focus()
  expect(getComputedStyle(output).outlineStyle).toBe('none')
  expect(getComputedStyle(output).boxShadow).toBe('none')
  if (window.innerWidth < 640 && window.innerHeight >= 416) {
    const actions = page
      .getByTestId('output-toolbar')
      .element()
      .querySelector('.primary-result-actions')!
      .getBoundingClientRect()
    const text = page
      .getByText(longTranslation, { exact: true })
      .element()
      .getBoundingClientRect()
    if (text.bottom > actions.top)
      expect(
        Math.abs(actions.bottom - output.getBoundingClientRect().bottom),
      ).toBeLessThanOrEqual(1)
  }
  assertWithinViewport(
    page
      .getByTestId('output-toolbar')
      .getByRole('button', { name: 'Copy', exact: true })
      .element(),
  )
  if (document.querySelector('.translator-panels[data-desktop]')) {
    const why = page
      .getByRole('heading', { name: /^Why this wording/, exact: true })
      .element()
      .getBoundingClientRect()
    const tips = page
      .getByRole('heading', { name: 'Learning tips', exact: true })
      .element()
      .getBoundingClientRect()
    expect(Math.abs(why.top - tips.top)).toBeLessThanOrEqual(2)
    expect(tips.left).toBeGreaterThan(why.right)
  }
  await page.screenshot({
    path: `../../test-results/design-${window.innerWidth}x${window.innerHeight}-long.png`,
  })
})

test('source grows for a long turn then shrinks again without losing Clear', async () => {
  await render(<Fixture />)
  const input = page.getByTestId('input-textarea')
  const textarea = input.element() as HTMLTextAreaElement
  await input.fill('Hi')
  const shortHeight = textarea.offsetHeight
  await input.fill(longSource)
  if (window.innerHeight >= 460)
    expect(textarea.offsetHeight).toBeGreaterThan(shortHeight)
  else expect(textarea.offsetHeight).toBeGreaterThanOrEqual(shortHeight)
  await input.fill('Hi')
  expect(textarea.offsetHeight).toBeLessThanOrEqual(shortHeight + 1)
  if (window.innerWidth >= 1100 && window.innerHeight >= 640)
    expect(textarea.offsetHeight).toBeLessThanOrEqual(60)
  await page.getByTestId('clear-input').click()
  await expect.element(input).toHaveValue('')
  expect(document.activeElement).toBe(textarea)
  await expect.element(page.getByTestId('paste-input')).toBeVisible()
  await expect.element(page.getByTestId('clear-input')).toBeVisible()
})

test('resize preserves the focused source node and the conversation draft', async () => {
  const original = [window.innerWidth, window.innerHeight] as const
  try {
    await page.viewport(736, 594)
    await render(<Fixture />)
    const input = page.getByTestId('input-textarea')
    await input.fill('Keep this unfinished conversation turn.')
    const node = input.element() as HTMLTextAreaElement
    node.setSelectionRange(5, 14)
    await page.viewport(382, 580)
    await expect
      .element(input)
      .toHaveValue('Keep this unfinished conversation turn.')
    expect(input.element()).toBe(node)
    expect(document.activeElement).toBe(node)
    expect([node.selectionStart, node.selectionEnd]).toEqual([5, 14])
    await page.viewport(736, 320)
    await expect
      .element(input)
      .toHaveValue('Keep this unfinished conversation turn.')
    expect(document.activeElement).toBe(node)
    expect([node.selectionStart, node.selectionEnd]).toEqual([5, 14])
  } finally {
    await page.viewport(...original)
  }
})

test('Paste replaces a turn and Copy sends the complete main result', async () => {
  const clipboard = {
    readText: vi.fn().mockResolvedValue(sourceText),
    writeText: vi.fn().mockResolvedValue(undefined),
  }
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  })
  try {
    await render(<Fixture />)
    await page.getByTestId('input-textarea').fill('Previous turn')
    await page.getByTestId('paste-input').click()
    await expect
      .element(page.getByTestId('input-textarea'))
      .toHaveValue(sourceText)
    await page
      .getByTestId('output-toolbar')
      .getByRole('button', { name: 'Copy', exact: true })
      .click()
    await expect
      .poll(() => clipboard.writeText.mock.calls[0]?.[0])
      .toBe('오늘 도와줘서 고마워요.')
    await page.getByTestId('clear-input').click()
    await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})

test('Copy works for a ready main translation while its details are still streaming', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  try {
    const initial = { ...sentence, done: false, mainReady: false }
    await render(<Fixture initial={initial} />)
    updateUrgent({ isPending: true, streaming: true })
    const copy = page
      .getByTestId('output-toolbar')
      .getByRole('button', { name: 'Copy', exact: true })
    await expect.element(copy).toBeDisabled()
    updateUrgent({ live: { ...initial, mainReady: true } })
    await expect.element(copy).toBeEnabled()
    await copy.click()
    await expect
      .poll(() => writeText.mock.calls[0]?.[0])
      .toBe('오늘 도와줘서 고마워요.')
    await page.getByTestId('input-textarea').fill('A different message')
    await expect.element(copy).toBeDisabled()
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})

test('landscape sentence notes use the card width without reserving bottom insets above the result', async () => {
  const original = [window.innerWidth, window.innerHeight] as const
  try {
    await page.viewport(960, 548)
    await render(
      <Fixture
        initial={{
          ...sentence,
          text: 'Hello how are you',
          requestKey: requestKey('Hello how are you'),
          partial: {
            ...sentence.partial,
            main: '안녕하세요, 어떻게 지내세요?',
            rationale:
              "The greeting is rendered with the polite 안녕하세요, while 어떻게 지내세요 naturally conveys asking about someone's current well-being rather than translating each word mechanically.",
            formalityNote:
              'The main translation uses polite 해요체, suitable for everyday conversation.',
            alternatives: [
              {
                text: '안녕, 잘 지내?',
                note: 'This uses the close-friend greeting 안녕 and the informal question 잘 지내?, so it sounds warmer and more familiar than the polite main translation.',
              },
              {
                text: '안녕하세요, 잘 지내세요?',
                note: 'A friendly polite greeting that works well in everyday conversation.',
              },
            ],
          },
        }}
      />,
    )
    const shell = document.querySelector<HTMLElement>('.app-shell')!
    shell.style.setProperty('--safe-area-bottom', '34px')
    window.dispatchEvent(new Event('resize'))
    const editor = document.querySelector('.composer')!.getBoundingClientRect()
    const target = page
      .getByTestId('target-toolbar')
      .element()
      .getBoundingClientRect()
    expect(target.top - editor.bottom).toBeLessThanOrEqual(16)
    const card = page.getByTestId('alternative-item').elements()[0]!
    const note = card
      .querySelector('.alternative-note')!
      .getBoundingClientRect()
    expect(note.width).toBeGreaterThan(card.getBoundingClientRect().width * 0.8)
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    )
    await page.screenshot({
      path: '../../test-results/sentence-landscape-density.png',
    })
    const secondTranslation = page
      .getByText('안녕하세요, 잘 지내세요?', { exact: true })
      .element()
    assertWithinViewport(secondTranslation)
    const copy = page
      .getByTestId('output-toolbar')
      .getByRole('button', { name: 'Copy', exact: true })
      .element()
    expect(copy.getBoundingClientRect().bottom).toBeLessThanOrEqual(548 - 34)
  } finally {
    await page.viewport(...original)
  }
})

test('Korean controls and a full input keep the conversation actions reachable', async () => {
  await render(<Fixture />)
  await page.getByRole('button', { name: '한', exact: true }).click()
  await expect
    .element(page.getByTestId('paste-input'))
    .toHaveTextContent('붙여넣기')
  await expect
    .element(page.getByTestId('clear-input'))
    .toHaveTextContent('지우기')
  await page.getByTestId('input-textarea').fill('a'.repeat(5001))
  for (const name of ['paste-input', 'clear-input'])
    assertWithinViewport(page.getByTestId(name).element())
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  )
  await page.getByTestId('clear-input').click()
  await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
})

test.each(['book', 'laptop'] as const)(
  'fold posture %s preserves the turn and reachable controls',
  async (posture) => {
    const original = [window.innerWidth, window.innerHeight] as const
    const nativeMatchMedia = window.matchMedia.bind(window)
    let folded = false
    const media = new Map<string, MediaQueryList>()
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      if (!query.includes('device-posture')) return nativeMatchMedia(query)
      if (!media.has(query)) {
        const events = new EventTarget()
        media.set(query, {
          get matches() {
            return (
              folded &&
              query.includes(posture === 'book' ? 'horizontal' : 'vertical')
            )
          },
          media: query,
          addEventListener: events.addEventListener.bind(events),
          removeEventListener: events.removeEventListener.bind(events),
          dispatchEvent: events.dispatchEvent.bind(events),
        } as MediaQueryList)
      }
      return media.get(query)!
    })
    try {
      await page.viewport(736, 736)
      await render(<Fixture />)
      const input = page.getByTestId('input-textarea')
      await input.fill('Keep this conversation while folding.')
      const node = input.element()
      folded = true
      media.forEach((item) => item.dispatchEvent(new Event('change')))
      await expect
        .poll(() =>
          document
            .querySelector('.translator-panels')
            ?.getAttribute('data-layout'),
        )
        .toBe(posture)
      expect(input.element()).toBe(node)
      expect(document.activeElement).toBe(node)
      for (const name of ['paste-input', 'clear-input'])
        assertWithinViewport(page.getByTestId(name).element())
      const source = document
        .querySelector('.input-panel')!
        .getBoundingClientRect()
      const result = document
        .querySelector('.output-panel')!
        .getBoundingClientRect()
      if (posture === 'book')
        expect(source.right).toBeLessThanOrEqual(result.left)
      else expect(result.bottom).toBeLessThanOrEqual(source.top)
      folded = false
      media.forEach((item) => item.dispatchEvent(new Event('change')))
      await expect
        .poll(() =>
          document
            .querySelector('.translator-panels')
            ?.getAttribute('data-layout'),
        )
        .toBe('stack')
      await expect
        .element(input)
        .toHaveValue('Keep this conversation while folding.')
    } finally {
      vi.restoreAllMocks()
      await page.viewport(...original)
    }
  },
)

test('dictionary metadata stays with the result and synonyms start a new lookup', async () => {
  await render(<Fixture initial={word} />)
  if (!document.querySelector('[data-desktop]'))
    await page
      .getByRole('button', { name: 'About · library', exact: true })
      .click()
  await expect
    .element(
      page.getByText(
        'A place where books are kept for reading and borrowing.',
        { exact: true },
      ),
    )
    .toBeVisible()
  await page.getByRole('button', { name: 'reading room', exact: true }).click()
  await expect
    .element(page.getByTestId('input-textarea'))
    .toHaveValue('reading room')
})

test.each([
  { width: 440, height: 640, right: 80, bottom: 34 },
  { width: 382, height: 580, right: 48, bottom: 34 },
  { width: 640, height: 382, right: 0, bottom: 34 },
  { width: 640, height: 320, right: 0, bottom: 34 },
  { width: 640, height: 320, right: 80, bottom: 34 },
  { width: 440, height: 320, right: 80, bottom: 34 },
])(
  'Safari safe areas keep backgrounds full width and actions reachable at $width × $height',
  async ({ width, height, right, bottom }) => {
    const original = [window.innerWidth, window.innerHeight] as const
    try {
      await page.viewport(width, height)
      await render(
        <Fixture
          initial={{
            ...sentence,
            text: longSource,
            requestKey: requestKey(longSource),
            partial: { ...sentence.partial, main: longTranslation },
          }}
        />,
      )
      const shell = document.querySelector<HTMLElement>('.app-shell')!
      shell.style.setProperty('--safe-area-top', '12px')
      shell.style.setProperty('--safe-area-right', `${right}px`)
      shell.style.setProperty('--safe-area-bottom', `${bottom}px`)
      shell.style.setProperty('--safe-area-left', '0px')
      await expect
        .poll(() =>
          Math.max(
            ...[...document.querySelectorAll('.input-panel,.output-panel')].map(
              (panel) => panel.getBoundingClientRect().right,
            ),
          ),
        )
        .toBe(width)
      expect(shell.getBoundingClientRect().right).toBe(width)
      for (const selector of [
        '[data-testid="paste-input"]',
        '[data-testid="clear-input"]',
        '.app-settings',
        '[data-testid="output-toolbar"] .copy-button',
      ]) {
        const bounds = document.querySelector(selector)!.getBoundingClientRect()
        expect(bounds.right).toBeLessThanOrEqual(width - right)
        expect(bounds.bottom).toBeLessThanOrEqual(height - bottom)
        expect(bounds.left).toBeGreaterThanOrEqual(0)
        const contextBounds = page
          .getByTestId('context-toggle')
          .element()
          .getBoundingClientRect()
        if (selector.includes('clear-input'))
          expect(
            Math.max(
              0,
              Math.min(bounds.right, contextBounds.right) -
                Math.max(bounds.left, contextBounds.left),
            ) *
              Math.max(
                0,
                Math.min(bounds.bottom, contextBounds.bottom) -
                  Math.max(bounds.top, contextBounds.top),
              ),
          ).toBe(0)
      }
      expect(document.documentElement.scrollWidth).toBe(width)
      const copy = document
        .querySelector('[data-testid="output-toolbar"] .copy-button')!
        .getBoundingClientRect()
      expect(copy.bottom).toBeLessThanOrEqual(
        Math.min(
          height - bottom,
          document.querySelector('.output-panel')!.getBoundingClientRect()
            .bottom,
        ),
      )
      await page.screenshot({
        path: `../../test-results/safari-safe-area-${width}x${height}.png`,
      })
      await page.getByTestId('clear-input').click()
      await expect
        .element(
          page.getByText('Your translation appears here.', { exact: true }),
        )
        .toBeVisible()
      expect(
        page.getByRole('button', { name: /try a|sample/i }).query(),
      ).toBeNull()
      await page.screenshot({
        path: `../../test-results/safari-safe-area-${width}x${height}-empty.png`,
      })
    } finally {
      await page.viewport(...original)
    }
  },
)

test.each([
  [920, 540],
  [1024, 600],
  [736, 594],
] as const)(
  'wide shallow %i × %i keeps the dictionary details visible',
  async (width, height) => {
    const original = [window.innerWidth, window.innerHeight] as const
    try {
      await page.viewport(width, height)
      const usageText =
        'Anticipatory excitement before a trip, a date, or a first day.'
      const definition =
        'To feel excited or nervous about something you are looking forward to.'
      const initial: LiveResult = {
        ...word,
        text: '설레다',
        requestSource: 'auto',
        requestKey: translationRequestKey({
          text: '설레다',
          source: 'auto',
          target: 'en',
          mode: 'friends',
          context: '',
          refinements: [],
          uiLang: 'en',
        }),
        partial: {
          ...word.partial,
          sourceLang: 'ko',
          targetLang: 'en',
          headword: '설레다',
          primaryTranslation: 'to be excited',
          primaryUsageNote: usageText,
          alternativeTranslations: [
            {
              text: 'to have butterflies',
              note: 'A little nervous excitement.',
              register: [],
            },
            {
              text: 'to be thrilled',
              note: 'Stronger excitement.',
              register: [],
            },
          ],
          posList: [
            {
              pos: 'verb',
              senses: [{ definition, register: [], examples: [] }],
            },
          ],
          synonyms: ['두근거리다', '들뜨다'],
          etymology: 'A native Korean word.',
          learningTips: {
            grammar: '설레다 becomes 설레요 in polite speech.',
            vocab: '설렘 is the noun form.',
            characters: [],
          },
        },
      }
      await render(
        <Fixture
          initial={initial}
          initialSource="auto"
          initialTarget="en"
          initialMode="friends"
          initialDetected="ko"
        />,
      )
      const source = document
        .querySelector('.input-panel')!
        .getBoundingClientRect()
      expect(source.height).toBeLessThanOrEqual(140)
      expect(
        page.getByTestId('input-textarea').element().getBoundingClientRect()
          .height,
      ).toBeLessThanOrEqual(60)
      await expect
        .element(page.getByRole('heading', { name: 'Usage', exact: true }))
        .toBeVisible()
      const usage = page.getByText(usageText, { exact: true }).element()
      const alternative = page
        .getByText('to have butterflies', { exact: true })
        .element()
      assertWithinViewport(usage)
      assertWithinViewport(alternative)
      assertWithinViewport(
        page.getByText(definition, { exact: true }).element(),
      )
      expect(usage.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        document.querySelector('.output-panel')!.getBoundingClientRect().bottom,
      )
      for (const selector of ['paste-input', 'clear-input'])
        assertWithinViewport(page.getByTestId(selector).element())
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      )
      await page.screenshot({
        path: `../../test-results/dictionary-density-${width}x${height}.png`,
      })
      await page
        .getByRole('group', { name: 'Source language' })
        .getByTestId('lang-more-trigger')
        .click()
      const menu = page.getByRole('listbox')
      await expect.element(menu).toBeVisible()
      expect(
        menu.element().getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(132)
      assertWithinViewport(menu.element())
    } finally {
      await page.viewport(...original)
    }
  },
)
