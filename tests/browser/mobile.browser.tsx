import { act, startTransition, useRef, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
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
const phraseNotes = {
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
    learningPhrases: [
      {
        text: '오늘',
        gloss: 'today',
        sourceTexts: ['today'],
        baseForm: '오늘',
        literalMeaning: '',
        naturalMeaning: 'today',
        grammar: '',
        omissions: '',
        usageNote: '',
        characters: [],
        grammarHighlights: [],
      },
      {
        text: '도와줘서',
        gloss: 'for helping me',
        sourceTexts: ['helping me'],
        baseForm: '도와주다',
        literalMeaning: 'because you helped',
        naturalMeaning: 'for helping me',
        grammar: '-어서 gives the reason for thanks.',
        omissions: 'The participants are understood.',
        usageNote: phraseNotes.vocab,
        characters: [],
        grammarHighlights: ['줘서'],
      },
      {
        text: '고마워요',
        gloss: 'thanks',
        sourceTexts: ['Thanks'],
        baseForm: '고맙다',
        literalMeaning: 'to be grateful',
        naturalMeaning: 'thanks',
        grammar: phraseNotes.grammar,
        omissions: '',
        usageNote: '',
        characters: [],
        grammarHighlights: ['고마워요'],
      },
    ],
  },
}
const learningForText = (text: string) =>
  [...new Intl.Segmenter('ko', { granularity: 'sentence' }).segment(text)]
    .filter((part) => part.segment.trim())
    .map((part) => ({
      text: part.segment.trim(),
      gloss: 'A sentence from this translation.',
      sourceTexts: [],
      baseForm: '',
      literalMeaning: '',
      naturalMeaning: '',
      grammar: '',
      omissions: '',
      usageNote: '',
      characters: [],
      grammarHighlights: [],
    }))
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
    grammar: '도서관 is a noun; 에 and 에서 mark its use as a location.',
    characters: [],
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
  flushPending = () => false,
}: {
  initial?: LiveResult | null
  initialSource?: Context['source']
  initialTarget?: Context['target']
  initialMode?: Context['mode']
  initialDetected?: Context['detected']
  initialError?: Context['error']
  flushPending?: Context['flush']
}) {
  const [state, setState] = useState<State>({
    input: initial?.text ?? '',
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
    flush: flushPending,
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

async function settledScreenshot(options: { path: string }) {
  await Promise.all(
    [...document.getAnimations()]
      .filter((animation) =>
        Number.isFinite(animation.effect?.getComputedTiming().endTime ?? 0),
      )
      .map((animation) => animation.finished.catch(() => {})),
  )
  await page.screenshot(options)
}

async function assertServerFirstPaint(sideInset: number) {
  const html = renderToString(<Fixture initial={null} />)
  await render(
    <div data-testid="ssr-host" dangerouslySetInnerHTML={{ __html: html }} />,
  )
  const host = page.getByTestId('ssr-host').element()
  host.style.setProperty('--safe-area-left', `${sideInset}px`)
  host.style.setProperty('--safe-area-right', `${sideInset}px`)
  const source = host.querySelector('.input-panel')!
  const output = host.querySelector('.output-panel')!
  const usableWidth = window.innerWidth - sideInset * 2
  const twoColumns =
    usableWidth >= 1100 ||
    (usableWidth >= 560 && usableWidth > window.innerHeight)
  const before = [
    source,
    output,
    host.querySelector('.composer')!,
    host.querySelector('textarea')!,
    host.querySelector('[data-testid="output-toolbar"] .copy-button')!,
    host.querySelector(
      '[data-testid="output-toolbar"] [data-testid="listen-button"]',
    )!,
  ].map((e) => e.getBoundingClientRect())
  const languageButtons = () =>
    [...host.querySelectorAll<HTMLElement>('.language-chip-bar')]
      .filter((bar) => bar.checkVisibility())
      .sort((a, b) =>
        String(a.getAttribute('aria-label')).localeCompare(
          String(b.getAttribute('aria-label')),
        ),
      )
      .map((bar) => {
        const sourceBar = bar.getAttribute('aria-label') === 'Source language'
        const expanded = bar.clientWidth >= (sourceBar ? 320 : 280)
        const visible = [
          ...bar.querySelectorAll<HTMLElement>('[data-testid="lang-chip"]'),
        ].filter((chip) => chip.checkVisibility())
        expect(visible.map((chip) => chip.dataset.value)).toEqual(
          expanded
            ? sourceBar
              ? ['auto', 'en', 'ko', 'ja']
              : ['en', 'ko', 'ja']
            : sourceBar
              ? ['en']
              : ['ko'],
        )
        return [
          ...visible,
          bar.querySelector('[data-testid="lang-more-trigger"]')!,
        ].map((button) => button.getBoundingClientRect())
      })
  const buttonsBefore = languageButtons()
  if (twoColumns) {
    expect(Math.abs(before[0]!.top - before[1]!.top)).toBeLessThanOrEqual(1)
    expect(before[0]!.right).toBeLessThanOrEqual(before[1]!.left + 1)
  } else {
    expect(before[1]!.bottom).toBeLessThanOrEqual(before[0]!.top + 1)
  }
  if (!sideInset)
    await settledScreenshot({
      path: `../../test-results/first-paint-${window.innerWidth}x${window.innerHeight}-ssr.png`,
    })
  const recoverable = vi.fn()
  let root: ReturnType<typeof hydrateRoot> | undefined
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  try {
    await act(async () => {
      root = hydrateRoot(host, <Fixture initial={null} />, {
        onRecoverableError: recoverable,
      })
    })
    await expect
      .poll(() =>
        host.querySelector('.translator-panels')?.getAttribute('data-layout'),
      )
      .toBe(usableWidth >= 1100 ? 'workspace' : twoColumns ? 'split' : 'stack')
    const after = [
      source,
      output,
      host.querySelector('.composer')!,
      host.querySelector('textarea')!,
      host.querySelector('[data-testid="output-toolbar"] .copy-button')!,
      host.querySelector(
        '[data-testid="output-toolbar"] [data-testid="listen-button"]',
      )!,
    ].map((e) => e.getBoundingClientRect())
    const buttonsAfter = languageButtons()
    expect(buttonsAfter.map((bar) => bar.length)).toEqual(
      buttonsBefore.map((bar) => bar.length),
    )
    buttonsBefore.forEach((bar, i) =>
      bar.forEach((button, j) => {
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(
            Math.abs(button[key] - buttonsAfter[i]![j]![key]),
            `language button ${i}/${j} ${key}`,
          ).toBeLessThanOrEqual(1)
      }),
    )
    for (let i = 0; i < before.length; i++)
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(
          Math.abs(before[i]![key] - after[i]![key]),
          `element ${i} ${key}`,
        ).toBeLessThanOrEqual(1)
    expect(recoverable).not.toHaveBeenCalled()
  } finally {
    const hydratedRoot = root
    if (hydratedRoot) await act(async () => hydratedRoot.unmount())
    vi.unstubAllGlobals()
  }
}

test.each([0, 12, 64])(
  'server-rendered first paint matches hydration with %ipx side insets',
  assertServerFirstPaint,
)

test.each([
  [580, 382],
  [594, 580],
  [1110, 760],
  [1280, 760],
  [2048, 982],
])(
  'server-rendered first paint respects usable-width edges at %i × %i',
  async (width, height) => {
    const original = [window.innerWidth, window.innerHeight] as const
    try {
      await page.viewport(width, height)
      await assertServerFirstPaint(12)
    } finally {
      await page.viewport(...original)
    }
  },
)

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

test('main actions keep one stable slot while translation and explanation grow', async () => {
  await render(<Fixture initial={null} />)
  const toolbar = page.getByTestId('output-toolbar')
  const copy = toolbar.getByRole('button', { name: 'Copy', exact: true })
  const listen = toolbar.getByTestId('listen-button')
  await expect.element(copy).toBeVisible()
  await expect.element(copy).toBeDisabled()
  await expect.element(listen).toBeDisabled()
  const copyNode = copy.element()
  const listenNode = listen.element()
  updateUrgent({ input: sourceText, isPending: true, streaming: true })
  await expect
    .element(page.getByTestId('input-textarea'))
    .toHaveValue(sourceText)
  const before = [
    copyNode,
    listenNode,
    document.querySelector('.composer')!,
  ].map((e) => e.getBoundingClientRect())
  const initial: LiveResult = {
    ...sentence,
    done: false,
    mainReady: false,
    partial: {
      ...sentence.partial,
      main: '',
      rationale: '',
      formalityNote: '',
    },
  }
  for (const live of [
    initial,
    { ...initial, partial: { ...initial.partial, main: '오늘' } },
    {
      ...initial,
      mainReady: true,
      partial: {
        ...initial.partial,
        main: Array(10).fill(sentence.partial.main).join('\n'),
      },
    },
    {
      ...sentence,
      partial: {
        ...sentence.partial,
        main: Array(10).fill(sentence.partial.main).join('\n'),
        rationale: 'A longer explanation that wraps on a phone. '.repeat(6),
      },
    },
  ]) {
    updateUrgent({ live, isPending: !live.done, streaming: !live.done })
    await expect
      .poll(
        () =>
          document.querySelector('[data-testid="main-translation"]')
            ?.textContent,
      )
      .toContain(live.partial.main ?? '')
    expect(copy.element()).toBe(copyNode)
    expect(listen.element()).toBe(listenNode)
    if (live.mainReady || live.done) await expect.element(copy).toBeEnabled()
    else await expect.element(copy).toBeDisabled()
    const after = [
      copyNode,
      listenNode,
      document.querySelector('.composer')!,
    ].map((e) => e.getBoundingClientRect())
    after.forEach((rect, i) => {
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(
          Math.abs(rect[key] - before[i]![key]),
          `control ${i} ${key}`,
        ).toBeLessThanOrEqual(1)
    })
    for (const button of [copyNode, listenNode]) {
      assertWithinViewport(button)
      const rect = button.getBoundingClientRect()
      expect(
        button.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        ),
      ).toBe(true)
    }
  }
  await settledScreenshot({
    path: `../../test-results/stable-actions-${window.innerWidth}x${window.innerHeight}-long.png`,
  })
  updateUrgent({
    error: { kind: 'server', message: 'Unavailable' },
    streaming: false,
  })
  await expect.element(copy).toBeDisabled()
  await expect.element(listen).toBeDisabled()
})

test('header settings keep their position when sentence adjustments first appear', async () => {
  await render(<Fixture initial={null} />)
  const controls = [
    ...document.querySelectorAll<HTMLElement>(
      '.mode-segment,.mode-select,.settings-trigger',
    ),
  ].filter((e) => e.checkVisibility())
  const before = controls.map((e) => e.getBoundingClientRect())
  updateUrgent({ input: sourceText, live: sentence })
  await expect
    .element(page.getByTestId('main-translation'))
    .toHaveTextContent(sentence.partial.main)
  controls.forEach((control, i) => {
    const after = control.getBoundingClientRect()
    expect(control.checkVisibility()).toBe(true)
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(
        Math.abs(after[key] - before[i]![key]),
        `header ${i} ${key}`,
      ).toBeLessThanOrEqual(1)
  })
})

test('wide workspaces put excess space outside and align tone and mirrored actions', async () => {
  if (window.innerWidth !== 1512) return
  const original = [window.innerWidth, window.innerHeight] as const
  try {
    await render(
      <Fixture
        initial={{
          ...word,
          partial: {
            ...word.partial,
            grammar:
              '도서관 is a noun; 에 and 에서 mark its use as a location.',
            notes: '도서 means books; 관 means a building.',
            characters: [],
          },
        }}
      />,
    )
    for (const width of [1280, 1512, 1728, 2048]) {
      await page.viewport(width, 982)
      await expect
        .poll(() =>
          document.querySelector('.app-shell')?.getAttribute('data-layout'),
        )
        .toBe('workspace')
      const shell = document
        .querySelector('.app-shell')!
        .getBoundingClientRect()
      await expect
        .poll(
          () =>
            document.querySelector('.app-shell')!.getBoundingClientRect().width,
        )
        .toBe(Math.min(width, 1536))
      expect(
        Math.abs(shell.left - (width - shell.width) / 2),
      ).toBeLessThanOrEqual(1)
      const result = page
        .getByTestId('main-translation')
        .element()
        .getBoundingClientRect()
      const tone = document
        .querySelector('.mode-segment')!
        .getBoundingClientRect()
      expect(Math.abs(tone.left - result.left)).toBeLessThanOrEqual(1)
      const paste = page
        .getByTestId('paste-input')
        .element()
        .getBoundingClientRect()
      const clear = page
        .getByTestId('clear-input')
        .element()
        .getBoundingClientRect()
      const copy = page
        .getByTestId('output-toolbar')
        .getByRole('button', { name: 'Copy', exact: true })
        .element()
        .getBoundingClientRect()
      const languages = document
        .querySelector('[aria-label="Source language"]')!
        .getBoundingClientRect()
      const editor = page
        .getByTestId('input-textarea')
        .element()
        .getBoundingClientRect()
      expect(Math.abs(paste.top - copy.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(clear.top - copy.top)).toBeLessThanOrEqual(1)
      expect(languages.right).toBeLessThanOrEqual(paste.left)
      expect(clear.bottom).toBeLessThanOrEqual(editor.top)
      const output = document
        .querySelector('.output-panel')!
        .getBoundingClientRect()
      const content = document
        .querySelector('.result-content')!
        .getBoundingClientRect()
      expect(output.right - content.right).toBeLessThanOrEqual(32)
      await settledScreenshot({
        path: `../../test-results/workspace-alignment-${width}.png`,
      })
    }
  } finally {
    await page.viewport(...original)
  }
})

test('dock speech failures stay visible inside the result pane', async () => {
  vi.mocked(speak).mockRejectedValue(new Error('Unavailable'))
  await render(<Fixture />)
  await page.getByTestId('output-toolbar').getByTestId('listen-button').click()
  const status = page.getByTestId('output-toolbar').getByRole('status')
  await expect.element(status).toBeVisible()
  const panel = document.querySelector('.output-panel')!.getBoundingClientRect()
  const bounds = status.element().getBoundingClientRect()
  expect(bounds.top).toBeGreaterThanOrEqual(panel.top)
  expect(bounds.bottom).toBeLessThanOrEqual(panel.bottom)
  expect(bounds.left).toBeGreaterThanOrEqual(panel.left)
  expect(bounds.right).toBeLessThanOrEqual(panel.right)
})

test('wide result languages cannot overlap the reserved main actions near the breakpoint', async () => {
  const original = [window.innerWidth, window.innerHeight] as const
  try {
    await page.viewport(1200, 760)
    await render(<Fixture />)
    const shell = document.querySelector<HTMLElement>('.app-shell')!
    shell.style.setProperty('--safe-area-right', '80px')
    window.dispatchEvent(new Event('resize'))
    const copy = page
      .getByTestId('output-toolbar')
      .getByRole('button', { name: 'Copy', exact: true })
      .element()
    const bar = page.getByRole('group', { name: 'Target language' }).element()
    await expect.poll(() => bar.clientWidth).toBeLessThan(280)
    const more = page
      .getByRole('group', { name: 'Target language' })
      .getByTestId('lang-more-trigger')
      .element()
    expect(more.getBoundingClientRect().right + 8).toBeLessThanOrEqual(
      copy.getBoundingClientRect().left,
    )
    const bounds = more.getBoundingClientRect()
    expect(
      more.contains(
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        ),
      ),
    ).toBe(true)
  } finally {
    await page.viewport(...original)
  }
})

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
  await settledScreenshot({
    path: `../../test-results/design-${window.innerWidth}x${window.innerHeight}-short.png`,
  })
})

test.each([false, true])(
  'folded translation keeps the editor expanded without a collapse control (keyboard %s)',
  async (keyboard) => {
    const original = [window.innerWidth, window.innerHeight] as const
    const viewport = Object.assign(new EventTarget(), {
      height: 640,
      width: 440,
      offsetTop: 0,
      scale: 1,
    })
    try {
      await page.viewport(440, 640)
      vi.stubGlobal('visualViewport', viewport)
      const initial: LiveResult = {
        ...word,
        text: 'Hello world',
        requestKey: requestKey('Hello world'),
        done: true,
        partial: {
          ...word.partial,
          headword: 'Hello world',
          primaryTranslation: '안녕하세요, 여러분',
          alternativeTranslations: [
            {
              text: '안녕, 여러분',
              register: ['casual'],
              note: 'More relaxed and suitable for friends or an informal audience.',
            },
            {
              text: '안녕하세요, 다들',
              register: [],
              note: 'A natural greeting for a group.',
            },
          ],
        },
      }
      await render(
        <Fixture
          initial={{
            ...initial,
            done: false,
            partial: {
              ...initial.partial,
              primaryTranslation: '',
              alternativeTranslations: [],
            },
          }}
        />,
      )
      const shell = document.querySelector<HTMLElement>('.app-shell')!
      shell.style.setProperty('--safe-area-right', '80px')
      shell.style.setProperty('--safe-area-bottom', '34px')
      window.dispatchEvent(new Event('resize'))
      const input = page
        .getByTestId('input-textarea')
        .element() as HTMLTextAreaElement
      input.focus({ preventScroll: true })
      input.setSelectionRange(3, 6)
      if (keyboard) {
        viewport.height = 300
        viewport.dispatchEvent(new Event('resize'))
      }
      updateUrgent({ live: initial })
      await expect
        .element(page.getByTestId('main-translation'))
        .toHaveTextContent('안녕하세요, 여러분')
      const source = document.querySelector<HTMLElement>('.input-panel')!
      await expect
        .poll(() => source.hasAttribute('data-source-compact'))
        .toBe(false)
      // Labelled Paste/Clear use a second compact row instead of icon-only actions.
      expect(source.getBoundingClientRect().height).toBeLessThanOrEqual(
        keyboard ? 180 : 300,
      )
      expect(page.getByTestId('input-textarea').element()).toBe(input)
      expect(document.activeElement).toBe(input)
      expect([input.selectionStart, input.selectionEnd]).toEqual([3, 6])
      const composer = document
        .querySelector('.composer')!
        .getBoundingClientRect()
      expect(composer.left).toBeGreaterThanOrEqual(12)
      expect(composer.height).toBeGreaterThan(110)
      expect(composer.bottom).toBeLessThanOrEqual(
        source.getBoundingClientRect().bottom,
      )
      expect(composer.right).toBeLessThanOrEqual(440 - 80 - 12)
      const primary = page.getByTestId('output-toolbar')
      for (const control of [
        primary.getByRole('button', { name: 'Copy', exact: true }).element(),
        primary.getByTestId('listen-button').element(),
      ]) {
        expect(getComputedStyle(control.querySelector('span')!).display).toBe(
          'none',
        )
        expect(control.getBoundingClientRect().width).toBeLessThanOrEqual(48)
        expect(control.getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
      }
      const first = page.getByTestId('alternative-item').elements()[0]!
      if (keyboard) first.scrollIntoView({ block: 'nearest' })
      await expect
        .element(page.getByText('안녕, 여러분', { exact: true }))
        .toBeVisible()
      expect(
        page
          .getByText('안녕, 여러분', { exact: true })
          .element()
          .getBoundingClientRect().bottom,
      ).toBeLessThanOrEqual(
        page.getByTestId('translation-result').element().getBoundingClientRect()
          .bottom,
      )
      expect(first.closest('[hidden]')).toBeNull()
      expect(
        document.querySelector('.output-panel .detail-learning'),
      ).toBeNull()
      expect(first.querySelector('.copy-button')!.textContent.trim()).toBe('')
      assertWithinViewport(
        primary.getByRole('button', { name: 'Copy', exact: true }).element(),
      )
      await settledScreenshot({
        path: `../../test-results/folded-result-first-${keyboard ? 'keyboard' : 'closed'}.png`,
      })
      await expect
        .element(page.getByTestId('source-expand'))
        .not.toBeInTheDocument()
      expect(page.getByTestId('input-textarea').element()).toBe(input)
      await page.getByTestId('context-toggle').click()
      await page.getByTestId('context-textarea').fill('A friendly greeting.')
      await page.getByTestId('context-toggle').click()
      await page.getByTestId('context-toggle').click()
      await expect
        .element(page.getByTestId('context-textarea'))
        .toHaveValue('A friendly greeting.')
      await page.getByTestId('clear-input').click()
      await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
      expect(document.activeElement).toBe(input)
    } finally {
      vi.unstubAllGlobals()
      await page.viewport(...original)
    }
  },
)

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
  await render(<Fixture initial={word} />)
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
  await page.getByTestId('word-details-trigger').click()
  // Pointer inspection waits for native selection before opening its panel.
  await expect.element(page.getByTestId('learning-inspector')).toBeVisible()
  await expect
    .element(page.getByText(word.partial.grammar!, { exact: true }))
    .toBeVisible()
  expect(
    page.getByRole('heading', { name: 'Learning tips', exact: true }).query(),
  ).toBeNull()
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
  await expect.element(listen).toBeDisabled()
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
    .toBeDisabled()
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
  const animated = [
    ...document.querySelectorAll('.animate-settle, .detail-enter'),
  ]
  expect(animated.length).toBeGreaterThan(0)
  for (const element of animated)
    expect(getComputedStyle(element).animationName).toBe(
      reduced
        ? 'none'
        : element.classList.contains('detail-enter')
          ? 'detail-in'
          : 'settle-in',
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

test('desktop source and reference share the left pane while alternatives stay right', async () => {
  if (window.innerWidth < 1100 || window.innerHeight < 640) return
  await render(<Fixture initial={withAlternatives} />)
  expect(
    document.querySelector('.translator-panels')!.getAttribute('data-layout'),
  ).toBe('workspace')
  const source = document.querySelector('.input-panel')!.getBoundingClientRect()
  const result = document
    .querySelector('.output-panel')!
    .getBoundingClientRect()
  expect(source.right).toBeLessThanOrEqual(result.left)
  expect(Math.abs(source.top - result.top)).toBeLessThanOrEqual(1)
  expect(
    page.getByTestId('input-textarea').element().getBoundingClientRect().height,
  ).toBeLessThan(source.height * 0.36)
  const footer = document
    .querySelector('.composer-actions')!
    .getBoundingClientRect()
  expect(
    footer.top -
      page.getByTestId('input-textarea').element().getBoundingClientRect()
        .bottom,
  ).toBeLessThanOrEqual(16)
  const alts = document
    .querySelector('.detail-alternatives')!
    .getBoundingClientRect()
  const whyBounds = document
    .querySelector('.detail-why')!
    .getBoundingClientRect()
  expect(whyBounds.left).toBeGreaterThanOrEqual(result.left)
  expect(whyBounds.top).toBeGreaterThanOrEqual(
    document.querySelector('.primary-result-actions')!.getBoundingClientRect()
      .bottom,
  )
  expect(alts.left).toBeGreaterThanOrEqual(result.left)
  expect(document.querySelectorAll('.detail-why')).toHaveLength(1)
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
  await page.getByTestId('learning-chunk').nth(2).click()
  await expect
    .element(page.getByText(phraseNotes.grammar, { exact: true }))
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
  await settledScreenshot({
    path: `../../test-results/design-${window.innerWidth}x${window.innerHeight}-alternatives.png`,
  })
})

test('word metadata stays separate from translation actions at every size', async () => {
  await render(<Fixture initial={word} />)
  await page.getByTestId('word-details-trigger').click()
  const actions = document.querySelector('.primary-result-actions')!
  expect(actions.textContent).not.toContain('noun')
  expect(actions.querySelector(':scope > kbd')).toBeNull()
  await expect
    .poll(() => document.querySelectorAll('.word-source-meta').length)
    .toBe(1)
  if (document.querySelector('.translator-panels[data-desktop]')) {
    expect(
      document.querySelector('.reference-panel .word-source-meta'),
    ).not.toBeNull()
    const copy = page
      .getByTestId('output-toolbar')
      .getByRole('button', { name: 'Copy', exact: true })
      .element()
    expect(copy.getAttribute('title')).toContain('C')
    expect(copy.querySelector('kbd')).toBeNull()
  } else {
    expect(actions.querySelector('kbd')).toBeNull()
    expect(
      document.querySelector(
        document.querySelector('.reference-panel')
          ? '.reference-panel .word-source-meta'
          : '.learning-panel .word-source-meta',
      ),
    ).not.toBeNull()
  }
  await settledScreenshot({
    path: `../../test-results/design-${window.innerWidth}x${window.innerHeight}-word.png`,
  })
})

test('reference notes track streaming clear and error without moving source focus', async () => {
  if (window.innerWidth < 1100) return
  await render(<Fixture initial={withAlternatives} />)
  const input = page
    .getByTestId('input-textarea')
    .element() as HTMLTextAreaElement
  input.focus()
  input.setSelectionRange(5, 14)
  updateUrgent({
    streaming: true,
    live: {
      ...withAlternatives,
      done: false,
      partial: {
        ...withAlternatives.partial,
        rationale: 'Notes are arriving.',
      },
    },
  })
  await expect
    .poll(
      () => document.querySelector('.output-panel .detail-why')?.textContent,
    )
    .toContain('Notes are arriving.')
  expect(document.activeElement).toBe(input)
  expect([input.selectionStart, input.selectionEnd]).toEqual([5, 14])
  updateUrgent({
    streaming: false,
    error: { kind: 'server', message: 'Connection lost.' },
  })
  await expect.poll(() => document.querySelector('.reference-panel')).toBeNull()
  updateUrgent({ error: null })
  await page.getByTestId('clear-input').click()
  await expect.poll(() => document.querySelector('.reference-panel')).toBeNull()
  expect(document.activeElement).toBe(input)
})

test('portrait keeps alternatives readable with an expanded multiline source', async () => {
  if (window.innerWidth >= 1100 || window.innerWidth > window.innerHeight)
    return
  await render(<Fixture initial={withAlternatives} />)
  const source = document.querySelector('.input-panel')!
  expect(source.hasAttribute('data-source-compact')).toBe(false)
  expect(source.getBoundingClientRect().height).toBeLessThanOrEqual(300)
  const editor = page
    .getByTestId('input-textarea')
    .element() as HTMLTextAreaElement
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight)
  expect(editor.clientHeight / lineHeight).toBeGreaterThanOrEqual(2)
  expect(
    document.querySelector('.detail-alternatives')!.closest('.output-panel'),
  ).not.toBeNull()
  expect(document.querySelector('.output-panel .detail-learning')).toBeNull()
  expect(document.querySelector('.learning-panel')).toBeNull()
  expect(document.querySelector('.reference-panel')).toBeNull()
  await expect
    .element(
      page
        .getByTestId('alternative-item')
        .first()
        .getByRole('button', { name: 'Copy', exact: true }),
    )
    .toBeVisible()
  await settledScreenshot({
    path: `../../test-results/design-${window.innerWidth}x${window.innerHeight}-alternatives.png`,
  })
})

test('Duo landscape uses source-side notes without changing pane order', async () => {
  if (window.innerWidth >= 1100 || window.innerWidth <= window.innerHeight)
    return
  await render(<Fixture initial={withAlternatives} />)
  const source = document.querySelector('.input-panel')!.getBoundingClientRect()
  const output = document
    .querySelector('.output-panel')!
    .getBoundingClientRect()
  expect(source.right).toBeLessThanOrEqual(output.left + 1)
  const reference = document.querySelector('.reference-panel')
  expect(reference).not.toBeNull()
  expect(reference!.closest('.input-panel')).not.toBeNull()
  expect(document.querySelector('.reference-panel .detail-why')).toBeNull()
  expect(document.querySelector('.output-panel .detail-why')).not.toBeNull()
  await expect
    .element(
      page.getByText('Natural wording for a friendly conversation.', {
        exact: true,
      }),
    )
    .toBeVisible()
  await expect.element(page.getByTestId('paste-input')).toBeVisible()
  await expect.element(page.getByTestId('clear-input')).toBeVisible()
  await settledScreenshot({
    path: `../../test-results/design-${window.innerWidth}x${window.innerHeight}-alternatives.png`,
  })
})

test.each([
  [580, 382],
  [736, 594],
  [1280, 760],
] as const)(
  'long source and expanded context keep actions reachable at %s by %s',
  async (width, height) => {
    const original = [window.innerWidth, window.innerHeight] as const
    try {
      await page.viewport(width, height)
      const text = Array(30).fill('Please translate this sentence.').join('\n')
      await render(
        <Fixture
          initial={{ ...withAlternatives, text, requestKey: requestKey(text) }}
        />,
      )
      const shell = document.querySelector<HTMLElement>('.app-shell')!
      shell.style.setProperty('--safe-area-bottom', '34px')
      const sourceNode = page
        .getByTestId('input-textarea')
        .element() as HTMLTextAreaElement
      sourceNode.focus()
      sourceNode.setSelectionRange(5, 14)
      await page.getByTestId('context-toggle').click()
      await page
        .getByTestId('context-textarea')
        .fill(Array(8).fill('An earlier reply with useful context.').join('\n'))
      const pane = document
        .querySelector('.input-panel')!
        .getBoundingClientRect()
      for (const id of ['paste-input', 'clear-input', 'context-toggle']) {
        const button = page.getByTestId(id).element()
        assertWithinViewport(button)
        expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          Math.min(pane.bottom, height - 34),
        )
      }
      expect(document.querySelector('.reference-panel')).toBeNull() // Changed reply context makes the old learning result stale.
      updateUrgent({ error: { kind: 'server', message: 'Connection lost.' } })
      await expect
        .poll(() => document.querySelector('.reference-panel'))
        .toBeNull()
      for (const id of ['paste-input', 'clear-input', 'context-toggle']) {
        expect(
          page.getByTestId(id).element().getBoundingClientRect().bottom,
        ).toBeLessThanOrEqual(height - 34)
      }
      const input = page
        .getByTestId('input-textarea')
        .element() as HTMLTextAreaElement
      expect(input).toBe(sourceNode)
      expect([input.selectionStart, input.selectionEnd]).toEqual([5, 14])
      const selected = input.value
      await page.getByTestId('context-toggle').click()
      expect(input.value).toBe(selected)
      await page.getByTestId('clear-input').click()
      expect(document.activeElement).toBe(input)
      await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
    } finally {
      await page.viewport(...original)
    }
  },
)

test('A workspace keeps long source and result controls above the safe bottom edge', async () => {
  const original = [window.innerWidth, window.innerHeight] as const
  try {
    await page.viewport(1280, 760)
    const text = Array(40).fill('Please translate this sentence.').join('\n')
    await render(
      <Fixture
        initial={{
          ...sentence,
          text,
          requestKey: requestKey(text),
          partial: {
            ...sentence.partial,
            main: longTranslation.repeat(8),
            learningPhrases: learningForText(longTranslation.repeat(8)),
            rationale: 'A clear explanation of the chosen wording. '.repeat(50),
          },
        }}
      />,
    )
    const shell = document.querySelector<HTMLElement>('.app-shell')!
    shell.style.setProperty('--safe-area-left', '20px')
    shell.style.setProperty('--safe-area-right', '64px')
    shell.style.setProperty('--safe-area-bottom', '34px')
    window.dispatchEvent(new Event('resize'))
    await expect
      .poll(() =>
        document
          .querySelector('.translator-panels')!
          .getAttribute('data-layout'),
      )
      .toBe('workspace')
    const input = page
      .getByTestId('input-textarea')
      .element() as HTMLTextAreaElement
    expect(input.scrollHeight).toBeGreaterThan(input.clientHeight)
    input.scrollTop = input.scrollHeight
    const reference = document.querySelector<HTMLElement>('.reference-scroll')!
    expect(reference).not.toBeNull()
    expect(reference.clientHeight).toBeGreaterThan(160)
    expect(reference.scrollHeight).toBeGreaterThan(reference.clientHeight)
    reference.scrollTop = reference.scrollHeight
    for (const selector of ['paste-input', 'clear-input']) {
      const control = page.getByTestId(selector).element()
      assertWithinViewport(control)
      const bounds = control.getBoundingClientRect()
      expect(bounds.bottom).toBeLessThanOrEqual(760 - 34)
      expect(bounds.left).toBeGreaterThanOrEqual(20)
      expect(bounds.right).toBeLessThanOrEqual(
        document.querySelector('.input-panel')!.getBoundingClientRect().right,
      )
    }
    const copyControl = page
      .getByTestId('output-toolbar')
      .getByRole('button', { name: 'Copy', exact: true })
      .element()
    assertWithinViewport(copyControl)
    const copy = copyControl.getBoundingClientRect()
    expect(copy.bottom).toBeLessThanOrEqual(760 - 34)
    expect(copy.right).toBeLessThanOrEqual(1280 - 64)
    const resultScroll = page
      .getByTestId('translation-result')
      .element() as HTMLElement
    resultScroll.scrollTop = resultScroll.scrollHeight
    await expect.poll(() => resultScroll.scrollTop).toBeGreaterThan(0)
    expect(copyControl.getBoundingClientRect().top).toBe(copy.top)
    assertWithinViewport(copyControl)
    await settledScreenshot({
      path: '../../test-results/a-workspace-long-safe.png',
    })
    await page.getByTestId('clear-input').click()
    expect(document.activeElement).toBe(input)
    await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
  } finally {
    await page.viewport(...original)
  }
})

test('long text keeps source learning separate from output wording without a result focus ring', async () => {
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
      expect(actions.top).toBeGreaterThanOrEqual(
        output.getBoundingClientRect().bottom,
      )
  }
  assertWithinViewport(
    page
      .getByTestId('output-toolbar')
      .getByRole('button', { name: 'Copy', exact: true })
      .element(),
  )
  expect(document.querySelector('.detail-learning')).toBeNull()
  await settledScreenshot({
    path: `../../test-results/design-${window.innerWidth}x${window.innerHeight}-long.png`,
  })
})

test('source sizing keeps Clear reachable for long and short turns', async () => {
  await render(<Fixture />)
  const input = page.getByTestId('input-textarea')
  const textarea = input.element() as HTMLTextAreaElement
  await input.fill('Hi')
  const shortHeight = textarea.offsetHeight
  await input.fill(longSource)
  const workspace =
    document
      .querySelector('.translator-panels')!
      .getAttribute('data-layout') === 'workspace'
  if (window.innerHeight >= 460)
    expect(textarea.offsetHeight).toBeGreaterThan(shortHeight)
  else expect(textarea.offsetHeight).toBeGreaterThanOrEqual(shortHeight)
  await input.fill('Hi')
  expect(textarea.offsetHeight).toBeLessThanOrEqual(shortHeight + 1)
  if (!workspace && window.innerWidth >= 1100 && window.innerHeight >= 640)
    expect(textarea.offsetHeight).toBeLessThanOrEqual(60)
  await page.getByTestId('clear-input').click()
  await expect.element(input).toHaveValue('')
  expect(document.activeElement).toBe(textarea)
  await expect.element(page.getByTestId('paste-input')).toBeVisible()
  await expect.element(page.getByTestId('clear-input')).toBeVisible()
})

test('workspace to Duo resizing preserves the source node cursor and applied context', async () => {
  const original = [window.innerWidth, window.innerHeight] as const
  try {
    await page.viewport(1512, 982)
    await render(<Fixture />)
    await page.getByTestId('context-toggle').click()
    await page
      .getByTestId('context-textarea')
      .fill('A friend asking about the weekend.')
    const input = page.getByTestId('input-textarea')
    await input.fill('Keep this unfinished conversation turn.')
    const node = input.element() as HTMLTextAreaElement
    node.setSelectionRange(5, 14)
    for (const [width, height, mode] of [
      [382, 580, 'stack'],
      [736, 594, 'split'],
      [1512, 982, 'workspace'],
    ] as const) {
      await page.viewport(width, height)
      await expect
        .poll(() =>
          document
            .querySelector('.translator-panels')!
            .getAttribute('data-layout'),
        )
        .toBe(mode)
      await expect
        .element(input)
        .toHaveValue('Keep this unfinished conversation turn.')
      expect(input.element()).toBe(node)
      expect(document.activeElement).toBe(node)
      expect([node.selectionStart, node.selectionEnd]).toEqual([5, 14])
      expect(
        (page.getByTestId('context-textarea').element() as HTMLTextAreaElement)
          .value,
      ).toBe('A friend asking about the weekend.')
    }
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
    const editor = document
      .querySelector('.input-panel')!
      .getBoundingClientRect()
    const target = page
      .getByTestId('target-toolbar')
      .element()
      .getBoundingClientRect()
    expect(
      document.querySelector('.translator-panels')!.getAttribute('data-layout'),
    ).toBe('split')
    expect(editor.right).toBeLessThanOrEqual(target.left)
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
    await settledScreenshot({
      path: '../../test-results/sentence-landscape-density.png',
    })
    const secondTranslation = page
      .getByText('안녕하세요, 잘 지내세요?', { exact: true })
      .element()
    secondTranslation.scrollIntoView({ block: 'center' })
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
  await page.getByTestId('settings-button').click()
  await page.getByRole('button', { name: '한', exact: true }).click()
  await userEvent.keyboard('{Escape}')
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

test.each([
  {
    width: 440,
    height: 640,
    visible: 300,
    offset: 80,
    right: 80,
    expected: 'stack',
  },
  {
    width: 594,
    height: 736,
    visible: 320,
    offset: 80,
    right: 0,
    expected: 'stack',
  },
  {
    width: 960,
    height: 548,
    visible: 210,
    offset: 110,
    right: 0,
    expected: 'split',
  },
  {
    width: 1280,
    height: 760,
    visible: 240,
    offset: 20,
    right: 64,
    expected: 'workspace',
  },
  {
    width: 440,
    height: 640,
    visible: 300,
    offset: 0,
    right: 80,
    top: 47,
    expected: 'stack',
  },
  {
    width: 960,
    height: 548,
    visible: 210,
    offset: 0,
    right: 0,
    top: 47,
    expected: 'split',
  },
])(
  'Safari keyboard keeps $width × $height in $expected with the main translation visible',
  async ({ width, height, visible, offset, right, expected, top = 0 }) => {
    const original = [window.innerWidth, window.innerHeight] as const
    const viewport = Object.assign(new EventTarget(), {
      height,
      width,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
    })
    try {
      await page.viewport(width, height)
      vi.stubGlobal('visualViewport', viewport)
      await render(
        <Fixture
          initial={{
            ...sentence,
            partial: {
              ...sentence.partial,
              rationale: 'A natural polite expression. '.repeat(40),
            },
          }}
        />,
      )
      const shell = document.querySelector<HTMLElement>('.app-shell')!
      shell.style.setProperty('--safe-area-right', `${right}px`)
      shell.style.setProperty('--safe-area-bottom', '34px')
      shell.style.setProperty('--safe-area-top', `${top}px`)
      window.dispatchEvent(new Event('resize'))
      const panels = document.querySelector<HTMLElement>('.translator-panels')!
      await expect.poll(() => panels.dataset.layout).toBe(expected)
      const order = [...panels.children]
      const scroll = page
        .getByTestId('translation-result')
        .element() as HTMLElement
      scroll.scrollTop = 250
      const input = page
        .getByTestId('input-textarea')
        .element() as HTMLTextAreaElement
      input.focus({ preventScroll: true })
      input.setSelectionRange(5, 10)
      for (
        let heightStep = height - 50;
        heightStep > visible;
        heightStep -= 50
      ) {
        viewport.height = heightStep
        viewport.dispatchEvent(new Event('resize'))
        await expect
          .poll(() => parseFloat(shell.style.getPropertyValue('--app-height')))
          .toBe(heightStep)
        expect(panels.dataset.layout).toBe(expected)
      }
      viewport.height = visible
      viewport.offsetTop = offset
      viewport.dispatchEvent(new Event('resize'))
      await expect.poll(() => shell.hasAttribute('data-keyboard')).toBe(true)
      expect(panels.dataset.layout).toBe(expected)
      expect([...panels.children]).toEqual(order)
      expect(page.getByTestId('input-textarea').element()).toBe(input)
      expect(document.activeElement).toBe(input)
      expect([input.selectionStart, input.selectionEnd]).toEqual([5, 10])
      await expect.poll(() => shell.getBoundingClientRect().top).toBe(offset)
      expect(shell.getBoundingClientRect().height).toBe(visible)
      await expect.poll(() => scroll.scrollTop).toBe(0)
      const main = page
        .getByTestId('main-translation')
        .element()
        .getBoundingClientRect()
      const copy = page
        .getByTestId('output-toolbar')
        .getByRole('button', { name: 'Copy', exact: true })
        .element()
        .getBoundingClientRect()
      expect(main.top).toBeGreaterThanOrEqual(Math.max(offset, top))
      if (copy.top < main.top) expect(copy.bottom).toBeLessThanOrEqual(main.top)
      else expect(main.bottom).toBeLessThanOrEqual(copy.top)
      for (const bounds of [
        copy,
        input.getBoundingClientRect(),
        page.getByTestId('paste-input').element().getBoundingClientRect(),
        page.getByTestId('clear-input').element().getBoundingClientRect(),
      ]) {
        expect(bounds.top).toBeGreaterThanOrEqual(Math.max(offset, top))
        expect(bounds.bottom).toBeLessThanOrEqual(offset + visible)
        expect(bounds.right).toBeLessThanOrEqual(width - right)
      }
      expect(document.scrollingElement!.scrollHeight).toBeLessThanOrEqual(
        height,
      )
      await settledScreenshot({
        path: `../../test-results/safari-keyboard-${width}x${height}.png`,
      })
      viewport.offsetTop += 20
      viewport.dispatchEvent(new Event('scroll'))
      await expect
        .poll(() => shell.getBoundingClientRect().top)
        .toBe(offset + 20)
      await page.getByTestId('context-toggle').click()
      await page
        .getByTestId('context-textarea')
        .fill('A friend is checking in.')
      const reply = page.getByTestId('context-textarea').element()
      reply.scrollIntoView({ block: 'nearest' })
      for (const element of [
        reply,
        page.getByTestId('paste-input').element(),
        page.getByTestId('clear-input').element(),
      ]) {
        const bounds = element.getBoundingClientRect()
        expect(bounds.top).toBeGreaterThanOrEqual(Math.max(offset + 20, top))
        expect(bounds.bottom).toBeLessThanOrEqual(offset + 20 + visible)
      }
      await page.getByTestId('clear-input').click()
      expect(document.activeElement).toBe(input)
      await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
      await expect
        .element(page.getByTestId('context-toggle'))
        .toHaveAttribute('aria-expanded', 'false')
      await page.getByTestId('context-toggle').click()
      await expect
        .element(page.getByTestId('context-textarea'))
        .toHaveValue('A friend is checking in.')
      viewport.height = height
      viewport.offsetTop = 0
      viewport.dispatchEvent(new Event('resize'))
      await expect.poll(() => shell.hasAttribute('data-keyboard')).toBe(false)
      expect(panels.dataset.layout).toBe(expected)
      expect(page.getByTestId('input-textarea').element()).toBe(input)
      await expect.poll(() => shell.getBoundingClientRect().top).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      await page.viewport(...original)
    }
  },
)

test.each([
  { posture: 'book', keyboard: false },
  { posture: 'book', keyboard: true },
  { posture: 'laptop', keyboard: false },
  { posture: 'laptop', keyboard: true },
] as const)(
  'fold posture $posture preserves the turn and reachable controls (keyboard $keyboard)',
  async ({ posture, keyboard }) => {
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
    const viewport = Object.assign(new EventTarget(), {
      width: 736,
      height: 736,
      offsetTop: 0,
      scale: 1,
    })
    try {
      await page.viewport(736, 736)
      vi.stubGlobal('visualViewport', viewport)
      await render(<Fixture />)
      const shell = document.querySelector<HTMLElement>('.app-shell')!
      shell.style.setProperty('--safe-area-bottom', '34px')

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
      if (keyboard) {
        viewport.height = 300
        viewport.dispatchEvent(new Event('resize'))
        await expect.poll(() => shell.hasAttribute('data-keyboard')).toBe(true)
      }
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
      const copy = page
        .getByTestId('output-toolbar')
        .getByRole('button', { name: 'Copy', exact: true })
        .element()
      const copyBox = copy.getBoundingClientRect()
      expect(copyBox.bottom).toBeLessThanOrEqual(viewport.height)
      if (posture === 'book') {
        expect(
          Math.abs(
            page.getByTestId('paste-input').element().getBoundingClientRect()
              .top - copyBox.top,
          ),
        ).toBeLessThanOrEqual(1)
      }
      viewport.height = 736
      viewport.dispatchEvent(new Event('resize'))
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
      vi.unstubAllGlobals()
      await page.viewport(...original)
    }
  },
)

test('dictionary metadata stays readable and synonyms start a new lookup', async () => {
  await render(<Fixture initial={word} />)
  await page.getByTestId('word-details-trigger').click()
  const about = page.getByRole('button', {
    name: 'About · library',
    exact: true,
  })
  if (about.query()) await about.click()
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
      await settledScreenshot({
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
      await settledScreenshot({
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
  'landscape %i × %i prioritizes alternatives and keeps dictionary details readable',
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
          grammar: '설레다 becomes 설레요 in polite speech.',
          notes: '설렘 is the noun form.',
          characters: [],
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
      const output = document
        .querySelector('.output-panel')!
        .getBoundingClientRect()
      expect(source.right).toBeLessThanOrEqual(output.left)
      expect(
        page.getByTestId('input-textarea').element().getBoundingClientRect()
          .height,
      ).toBeLessThanOrEqual(120)
      await expect
        .element(page.getByRole('heading', { name: 'Usage', exact: true }))
        .toBeVisible()
      const usage = page.getByText(usageText, { exact: true }).element()
      const alternative = page
        .getByText('to have butterflies', { exact: true })
        .element()
      assertWithinViewport(alternative)
      expect(usage.getBoundingClientRect().top).toBeLessThan(
        alternative.getBoundingClientRect().top,
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
      await settledScreenshot({
        path: `../../test-results/dictionary-density-${width}x${height}.png`,
      })
      usage.scrollIntoView({ block: 'center' })
      assertWithinViewport(usage)
      const meaning = page.getByText(definition, { exact: true }).element()
      meaning.scrollIntoView({ block: 'center' })
      assertWithinViewport(meaning)
      expect(
        parseFloat(getComputedStyle(meaning).fontSize),
      ).toBeGreaterThanOrEqual(15)
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

test('aligned workspace keeps matching action boxes and usage with its translation', async () => {
  await render(
    <Fixture
      initial={{
        ...word,
        partial: {
          ...word.partial,
          primaryUsageNote: 'Use this for a public lending library.',
        },
      }}
    />,
  )
  const actions = document.querySelector('.primary-result-actions')!
  const copy = actions.querySelector('.copy-button')!
  const listen = actions.querySelector('.listen-button')!
  const a = copy.getBoundingClientRect()
  const b = listen.getBoundingClientRect()
  expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1)
  expect(actions.querySelector('kbd')).toBeNull()
  const why = document.querySelector('.output-panel .detail-why')!
  expect(why.textContent).toContain('Use this for a public lending library.')
  expect(why.closest('[hidden]')).toBeNull()
  expect(why.closest('.result-scroll')).not.toBeNull()
  expect(actions.closest('.result-scroll')).toBeNull()
  expect(document.querySelector('.reference-panel .detail-why')).toBeNull()
  if (document.querySelector('.reference-panel')) {
    expect(
      document.querySelector('.reference-panel .word-source-meta'),
    ).not.toBeNull()
    const source = document
      .querySelector('.input-panel')!
      .getBoundingClientRect()
    const result = document
      .querySelector('.output-panel')!
      .getBoundingClientRect()
    expect(source.right).toBeLessThanOrEqual(result.left + 1)
    expect(
      getComputedStyle(document.querySelector('.input-panel')!).backgroundColor,
    ).toBe(
      getComputedStyle(document.querySelector('.output-panel')!)
        .backgroundColor,
    )
  }
})

test.each(['en', 'ko'] as const)(
  'labelled speech actions fit their box while loading and playing in %s',
  async (lang) => {
    if (window.innerWidth < 1100) return
    localStorage.setItem('ui-lang', lang)
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(speak).mockImplementation(async () => {
      await waiting
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'audio',
            audio: new Uint8Array(480),
            sampleRate: 24000,
          })
          controller.enqueue({ type: 'done' })
          controller.close()
        },
      })
    })
    await render(
      <Fixture
        initial={{
          ...sentence,
          partial: {
            ...sentence.partial,
            main:
              lang === 'en'
                ? '정말 도와줘서 고맙습니다.'
                : '친절하게 도와줘서 고마워요.',
          },
          requestKey: translationRequestKey({
            text: sourceText,
            source: 'en',
            target: 'ko',
            mode: 'casual',
            context: '',
            refinements: [],
            uiLang: lang,
          }),
        }}
      />,
    )
    const listen = page
      .getByTestId('output-toolbar')
      .getByTestId('listen-button')
    const initial = listen.element().getBoundingClientRect()
    await listen.click()
    await expect.element(listen).toHaveAttribute('aria-busy', 'true')
    const control = listen.element()
    expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth)
    expect(control.getBoundingClientRect().width).toBe(initial.width)
    release()
    await expect.element(listen).toHaveAttribute('aria-busy', 'false')
    await expect.element(listen).toHaveAttribute('aria-pressed', 'true')
    expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth)
    expect(control.getBoundingClientRect().width).toBe(initial.width)
    await listen.click()
    await expect.element(listen).toHaveAttribute('aria-pressed', 'false')
  },
)

async function settleResultMotion() {
  await Promise.all(
    [...document.getAnimations()]
      .filter((animation) =>
        Number.isFinite(animation.effect?.getComputedTiming().endTime ?? 0),
      )
      .map((animation) => animation.finished.catch(() => {})),
  )
}

test('stream completion keeps Copy, language controls and existing alternatives anchored', async () => {
  const partial: LiveResult = {
    ...withAlternatives,
    done: false,
    mainReady: true,
  }
  await render(<Fixture initial={partial} />)
  updateUrgent({ isPending: true, streaming: true })
  await expect
    .element(
      page
        .getByTestId('output-toolbar')
        .getByRole('button', { name: 'Copy', exact: true }),
    )
    .toBeEnabled()
  const copy = page
    .getByTestId('output-toolbar')
    .getByRole('button', { name: 'Copy', exact: true })
    .element()
  const lang = page
    .getByTestId('target-toolbar')
    .getByRole('button', { name: '한국어', exact: true })
    .element()
  const alt = page.getByTestId('alternative-item').first().element()
  await settleResultMotion()
  await settledScreenshot({
    path: `../../test-results/streaming-${window.innerWidth}x${window.innerHeight}-details.png`,
  })
  const before = [copy, lang, alt].map((e) => e.getBoundingClientRect())
  await expect
    .element(page.getByTestId('output-toolbar').getByTestId('listen-button'))
    .toBeDisabled()
  await expect.element(page.getByTestId('refine-chip-softer')).toBeDisabled()
  const staticListen = page
    .getByTestId('output-toolbar')
    .getByTestId('listen-button')
    .element()
  const staticRefine = page.getByTestId('refine-chip-softer').element()
  updateUrgent({ live: withAlternatives, isPending: false, streaming: false })
  await expect
    .element(page.getByTestId('output-toolbar').getByTestId('listen-button'))
    .toBeVisible()
  await settleResultMotion()
  expect(
    page.getByTestId('output-toolbar').getByTestId('listen-button').element(),
  ).toBe(staticListen)
  expect(page.getByTestId('refine-chip-softer').element()).toBe(staticRefine)
  const after = [copy, lang, alt].map((e) => e.getBoundingClientRect())
  await settledScreenshot({
    path: `../../test-results/streaming-${window.innerWidth}x${window.innerHeight}-complete.png`,
  })
  for (let i = 0; i < before.length; i++) {
    expect(Math.abs(before[i]!.x - after[i]!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(before[i]!.y - after[i]!.y)).toBeLessThanOrEqual(1)
  }
})

test('wording placeholder uses its real text line height while main Copy stays available', async () => {
  const initial: LiveResult = {
    ...sentence,
    done: false,
    mainReady: false,
    partial: {
      ...sentence.partial,
      main: '',
      rationale: '',
      formalityNote: '',
    },
  }
  await render(<Fixture initial={initial} />)
  updateUrgent({ isPending: true, streaming: true })
  const copy = page
    .getByTestId('output-toolbar')
    .getByRole('button', { name: 'Copy', exact: true })
  await expect.element(copy).toBeDisabled()
  await settledScreenshot({
    path: `../../test-results/streaming-${window.innerWidth}x${window.innerHeight}-waiting.png`,
  })
  updateUrgent({
    live: {
      ...initial,
      mainReady: true,
      partial: { ...initial.partial, main: sentence.partial.main },
    },
  })
  await expect.element(copy).toBeEnabled()
  await settledScreenshot({
    path: `../../test-results/streaming-${window.innerWidth}x${window.innerHeight}-main-ready.png`,
  })
  const before = copy.element().getBoundingClientRect()
  const placeholderBox = document
    .querySelector('.main-explanation')!
    .getBoundingClientRect()
  updateUrgent({
    live: {
      ...initial,
      mainReady: true,
      partial: {
        ...initial.partial,
        main: sentence.partial.main,
        rationale: 'Natural wording.',
      },
    },
  })
  await expect
    .element(page.getByText('Natural wording.', { exact: true }))
    .toBeVisible()
  expect(
    Math.abs(before.top - copy.element().getBoundingClientRect().top),
  ).toBeLessThanOrEqual(1)
  const why = document.querySelector('.main-explanation')!
  expect(getComputedStyle(why).fontSize).toBe('14px')
  expect(
    Math.abs(placeholderBox.height - why.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(1)
  const main = page
    .getByTestId('main-translation')
    .element()
    .getBoundingClientRect()
  expect(why.getBoundingClientRect().top - main.bottom).toBeGreaterThanOrEqual(
    12,
  )
})

test('source surface stays stable while typing and controls keep keyboard focus', async () => {
  await render(<Fixture />)
  const input = page
    .getByTestId('input-textarea')
    .element() as HTMLTextAreaElement
  const field = document.querySelector('.composer-field')!
  const before = getComputedStyle(field).borderColor
  input.focus({ preventScroll: true })
  expect(getComputedStyle(field).borderColor).toBe(before)
  expect(getComputedStyle(field).boxShadow).toBe('none')
  expect(getComputedStyle(input).outlineStyle).toBe('none')
  await page.getByTestId('clear-input').click()
  expect(document.activeElement).toBe(input)
})

test('no-alternatives desktop example keeps all learning facts in phrase details', async () => {
  if (window.innerWidth !== 1512) return
  const original = [window.innerWidth, window.innerHeight] as const
  const text =
    'Your local changes are untouched, and your spec doc is still staged and uncommitted.'
  const initial: LiveResult = {
    ...sentence,
    text,
    requestKey: requestKey(text),
    partial: {
      sourceLang: 'en',
      targetLang: 'ko',
      main: '로컬 변경 사항은 그대로 건드리지 않았고, 사양 문서는 여전히 스테이징된 상태로 커밋되지 않았어요.',
      rationale:
        'The Git terms use standard Korean developer vocabulary, while 그대로 건드리지 않았고 emphasizes leaving the local changes untouched.',
      learningPhrases: [
        {
          text: '로컬 변경 사항은',
          gloss: 'your local changes',
          sourceTexts: ['Your local changes'],
          baseForm: '변경 사항',
          literalMeaning: 'local changes',
          naturalMeaning: 'your local changes',
          grammar: '',
          omissions: '',
          usageNote: '',
          characters: [
            {
              word: '변경 사항',
              chars: [
                { char: '變', meaning: 'change' },
                { char: '更', meaning: 'renewal' },
                { char: '事', meaning: 'matter' },
                { char: '項', meaning: 'item' },
              ],
            },
          ],
          grammarHighlights: [],
        },
        {
          text: '그대로 건드리지 않았고',
          gloss: 'have been left untouched',
          sourceTexts: ['untouched'],
          baseForm: '건드리다',
          literalMeaning: 'did not touch, and',
          naturalMeaning: 'have been left untouched',
          grammar:
            '-지 않았다 negates the past action; -고 connects it to the next clause.',
          omissions: 'The agent is understood from context.',
          usageNote: '',
          characters: [],
          grammarHighlights: ['지 않았고'],
        },
        {
          text: '사양 문서는',
          gloss: 'your spec document',
          sourceTexts: ['your spec doc'],
          baseForm: '사양 문서',
          literalMeaning: 'specification document',
          naturalMeaning: 'your spec document',
          grammar: '',
          omissions: '',
          usageNote: '',
          characters: [],
          grammarHighlights: [],
        },
        {
          text: '여전히 스테이징된 상태로',
          gloss: 'still staged',
          sourceTexts: ['still staged'],
          baseForm: '스테이징되다',
          literalMeaning: 'still in the staged state',
          naturalMeaning: 'still staged',
          grammar:
            '-된 상태로 describes a resulting state that remains in effect.',
          omissions: '',
          characters: [],
          grammarHighlights: ['된 상태로'],
          usageNote:
            '스테이징 and 커밋 are Korean developer loanwords for Git operations.',
        },
        {
          text: '커밋되지 않았어요',
          gloss: 'has not been committed',
          sourceTexts: ['uncommitted'],
          baseForm: '커밋되다',
          literalMeaning: 'has not been committed',
          naturalMeaning: 'uncommitted',
          grammar: '-지 않았어요 is a polite negative past ending.',
          omissions: 'The specification document remains the subject.',
          usageNote: '',
          characters: [],
          grammarHighlights: ['지 않았어요'],
        },
      ],
      alternatives: [],
    },
  }
  try {
    await render(<Fixture initial={initial} />)
    for (const width of [1512, 2048]) {
      await page.viewport(width, 982)
      await expect
        .element(page.getByTestId('learning-chunk').first())
        .toBeVisible()
      expect(document.querySelector('.detail-learning')).toBeNull()
      expect(
        document.querySelectorAll('[data-testid="learning-chunk"]'),
      ).toHaveLength(5)
      expect(document.querySelector('.detail-alternatives')).toBeNull()
      await settledScreenshot({
        path: `../../test-results/learning-balance-${width}.png`,
      })
    }
  } finally {
    await page.viewport(...original)
  }
})

test('technical translation description has a quieter measure and clear spacing', async () => {
  if (window.innerWidth !== 1512) return
  const text = "I'll put the split in a small helper under api/src/utils/"
  await render(
    <Fixture
      initial={{
        ...sentence,
        text,
        requestKey: requestKey(text),
        partial: {
          ...sentence.partial,
          main: '분할 로직은 api/src/utils/ 아래에 작은 헬퍼로 넣을게요.',
          learningPhrases: [],
          rationale:
            'The translation keeps the code path unchanged and renders “put … in a helper” as 넣다, a natural developer phrasing for implementing something as a helper function. 분할 로직 makes the implied programming object explicit without adding new technical detail.',
        },
      }}
    />,
  )
  const why = document.querySelector('.main-explanation')!
  expect(getComputedStyle(why).fontSize).toBe('14px')
  const main = page
    .getByTestId('main-translation')
    .element()
    .getBoundingClientRect()
  expect(why.getBoundingClientRect().top - main.bottom).toBeGreaterThanOrEqual(
    12,
  )
  await settledScreenshot({
    path: '../../test-results/motion-description-1512.png',
  })
})

test('mobile multiline source stays expanded while typing and after the result arrives', async () => {
  if (window.innerWidth >= 560) return
  await render(<Fixture initial={null} />)
  const input = page.getByTestId('input-textarea')
  const node = input.element() as HTMLTextAreaElement
  await input.fill('First line\nSecond line\nThird line')
  expect(
    document.querySelector('.input-panel')?.hasAttribute('data-source-compact'),
  ).toBe(false)
  expect(getComputedStyle(node).fontSize).toBe('18px')
  expect(node.getBoundingClientRect().height).toBeGreaterThanOrEqual(90)
  node.setSelectionRange(12, 15)
  updateUrgent({
    live: { ...sentence, text: node.value, requestKey: requestKey(node.value) },
  })
  expect(input.element()).toBe(node)
  expect([node.selectionStart, node.selectionEnd]).toEqual([12, 15])
  expect(node.getBoundingClientRect().height).toBeGreaterThanOrEqual(90)
  await settledScreenshot({
    path: `../../test-results/mobile-multiline-${window.innerWidth}.png`,
  })
})

test.each(['empty', 'translated', 'long'] as const)(
  'split source and result actions share a bottom dock for %s turns',
  async (state) => {
    if (window.innerWidth >= 1100) return
    const original = [window.innerWidth, window.innerHeight] as const
    const initial =
      state === 'empty'
        ? null
        : state === 'long'
          ? {
              ...sentence,
              text: longSource,
              requestKey: requestKey(longSource),
              partial: {
                ...sentence.partial,
                main: longTranslation,
                learningPhrases: learningForText(longTranslation),
              },
            }
          : sentence
    try {
      await render(<Fixture initial={initial} />)
      const input = page
        .getByTestId('input-textarea')
        .element() as HTMLTextAreaElement
      for (const [width, height] of [
        [580, 382],
        [736, 594],
        [960, 548],
      ] as const) {
        await page.viewport(width, height)
        await expect
          .poll(() =>
            document.querySelector('.app-shell')?.getAttribute('data-layout'),
          )
          .toBe('split')
        await expect
          .poll(
            () =>
              document.querySelector('.app-shell')!.getBoundingClientRect()
                .height,
          )
          .toBe(height)
        const copy = page
          .getByTestId('output-toolbar')
          .getByRole('button', { name: 'Copy', exact: true })
          .element()
          .getBoundingClientRect()
        for (const id of ['paste-input', 'clear-input', 'context-toggle']) {
          const control = page.getByTestId(id).element()
          expect(
            Math.abs(control.getBoundingClientRect().top - copy.top),
          ).toBeLessThanOrEqual(1)
          assertWithinViewport(control)
          expect(
            document
              .elementFromPoint(
                control.getBoundingClientRect().left +
                  control.getBoundingClientRect().width / 2,
                control.getBoundingClientRect().top + 22,
              )
              ?.closest('button'),
          ).toBe(control)
        }
        expect(page.getByTestId('input-textarea').element()).toBe(input)
        await settledScreenshot({
          path: `../../test-results/split-action-docks-${width}-${state}.png`,
        })
      }
    } finally {
      await page.viewport(...original)
    }
  },
)

test('Return adds a line even with a pending translation', async () => {
  await render(<Fixture initial={null} flushPending={() => true} />)
  const input = page.getByTestId('input-textarea')
  await input.fill('First line')
  const node = input.element() as HTMLTextAreaElement
  node.focus()
  node.setSelectionRange(node.value.length, node.value.length)
  await userEvent.keyboard('{Enter}')
  await expect.element(input).toHaveValue('First line\n')
  expect(document.activeElement).toBe(node)
})

test('folded keyboard editor has a continuous surface and named actions', async () => {
  const original = [window.innerWidth, window.innerHeight] as const
  const viewport = Object.assign(new EventTarget(), {
    height: 640,
    width: 440,
    offsetTop: 0,
    scale: 1,
  })
  try {
    await page.viewport(440, 640)
    vi.stubGlobal('visualViewport', viewport)
    await render(<Fixture initial={word} />)
    const shell = document.querySelector<HTMLElement>('.app-shell')!
    shell.style.setProperty('--safe-area-right', '80px')
    window.dispatchEvent(new Event('resize'))
    const input = page.getByTestId('input-textarea')
    const node = input.element() as HTMLTextAreaElement
    node.focus({ preventScroll: true })
    viewport.height = 300
    viewport.dispatchEvent(new Event('resize'))
    await expect.poll(() => shell.hasAttribute('data-keyboard')).toBe(true)
    await input.fill('Hello\nSecond line')
    const composer = document.querySelector('.composer')!
    expect(getComputedStyle(composer).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(composer).borderTopWidth).toBe('0px')
    await expect
      .element(page.getByTestId('source-expand'))
      .not.toBeInTheDocument()
    await expect
      .element(
        page
          .getByTestId('context-toggle')
          .getByText('Context', { exact: true }),
      )
      .toBeVisible()
    for (const id of ['paste-input', 'clear-input', 'context-toggle']) {
      assertWithinViewport(page.getByTestId(id).element())
    }
    expect(node.getBoundingClientRect().height).toBeGreaterThanOrEqual(76)
    expect(document.activeElement).toBe(node)
    await settledScreenshot({
      path: '../../test-results/folded-keyboard-editor.png',
    })
  } finally {
    vi.unstubAllGlobals()
    await page.viewport(...original)
  }
})

test.each([false, true])(
  'folding and unfolding preserve multiline editing and reachable actions (keyboard %s)',
  async (keyboard) => {
    const original = [window.innerWidth, window.innerHeight] as const
    const viewport = Object.assign(new EventTarget(), {
      height: 580,
      width: 382,
      offsetTop: 0,
      scale: 1,
    })
    const text =
      'First line to translate.\nSecond line to edit.\nThird line stays here.'
    try {
      await page.viewport(382, 580)
      vi.stubGlobal('visualViewport', viewport)
      await render(
        <Fixture
          initial={{ ...withAlternatives, text, requestKey: requestKey(text) }}
        />,
      )
      const input = page.getByTestId('input-textarea')
      const node = input.element() as HTMLTextAreaElement
      node.focus({ preventScroll: true })
      node.setSelectionRange(12, 15)
      const shell = document.querySelector<HTMLElement>('.app-shell')!
      shell.style.setProperty('--safe-area-bottom', '34px')
      for (const [width, height, mode] of [
        [382, 580, 'stack'],
        [594, 736, 'stack'],
        [736, 594, 'split'],
        [580, 382, 'split'],
        [382, 580, 'stack'],
      ] as const) {
        viewport.width = width
        viewport.height = keyboard ? Math.round(height * 0.5) : height
        await page.viewport(width, height)
        viewport.dispatchEvent(new Event('resize'))
        window.dispatchEvent(new Event('resize'))
        await expect.poll(() => shell.dataset.layout).toBe(mode)
        await expect
          .poll(() => Math.round(shell.getBoundingClientRect().height))
          .toBe(viewport.height)
        await expect
          .poll(() => shell.hasAttribute('data-keyboard'))
          .toBe(keyboard)
        expect(input.element()).toBe(node)
        expect(document.activeElement).toBe(node)
        expect([node.selectionStart, node.selectionEnd]).toEqual([12, 15])
        expect(node.value).toBe(text)
        expect(getComputedStyle(node).fontSize).toBe('18px')
        expect(node.getBoundingClientRect().height).toBeGreaterThanOrEqual(76)
        await expect
          .element(page.getByTestId('source-expand'))
          .not.toBeInTheDocument()
        const toolbar = page.getByTestId('output-toolbar')
        if (mode === 'split') {
          const paste = page
            .getByTestId('paste-input')
            .element()
            .getBoundingClientRect()
          const copy = toolbar
            .getByRole('button', { name: 'Copy', exact: true })
            .element()
            .getBoundingClientRect()
          expect(Math.abs(paste.top - copy.top)).toBeLessThanOrEqual(1)
        }
        for (const button of [
          page.getByTestId('paste-input').element(),
          page.getByTestId('clear-input').element(),
          page.getByTestId('context-toggle').element(),
          toolbar.getByRole('button', { name: 'Copy', exact: true }).element(),
          toolbar.getByTestId('listen-button').element(),
        ]) {
          const box = button.getBoundingClientRect()
          expect(box.width).toBeGreaterThanOrEqual(44)
          expect(box.height).toBeGreaterThanOrEqual(44)
          expect(box.top).toBeGreaterThanOrEqual(0)
          expect(box.bottom).toBeLessThanOrEqual(
            viewport.height - (keyboard ? 0 : 34),
          )
          expect(box.left).toBeGreaterThanOrEqual(0)
          expect(box.right).toBeLessThanOrEqual(width)
          const hit = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          )
          expect(hit && button.contains(hit)).toBeTruthy()
        }
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
        await settledScreenshot({
          path: `../../test-results/mobile-audit-${width}x${height}-${keyboard ? 'keyboard' : 'closed'}.png`,
        })
      }
      viewport.height = 580
      viewport.dispatchEvent(new Event('resize'))
      await expect.poll(() => shell.hasAttribute('data-keyboard')).toBe(false)
      expect(input.element()).toBe(node)
      expect(document.activeElement).toBe(node)
      expect([node.selectionStart, node.selectionEnd]).toEqual([12, 15])
    } finally {
      vi.unstubAllGlobals()
      await page.viewport(...original)
    }
  },
)
