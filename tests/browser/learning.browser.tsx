import { useRef, useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import TranslatorWorkspace from '../../src/components/TranslatorWorkspace'
import { useTranslatorContext } from '../../src/context/TranslatorContext'
import { UiLangProvider } from '../../src/hooks/useUiLang'
import { learn } from '../../src/server/learning'
import { translationRequestKey } from '../../src/lib/translationRequestKey'
import type { LiveResult } from '../../src/hooks/useTranslate'
import type { LearningResult } from '../../src/server/learningTypes'

vi.mock('../../src/context/TranslatorContext', () => ({
  useTranslatorContext: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
vi.mock('../../src/server/learning', () => ({ learn: vi.fn() }))
const sourceText = 'Thanks for helping me today.'
const translation = '오늘 도와줘서 고마워요.'
const fact = {
  baseForm: '도와주다',
  literalMeaning: 'because you helped',
  naturalMeaning: 'for helping me',
  grammar: '-어서 gives the reason for the thanks.',
  omissions: 'You and me are implicit.',
}
const analysis: LearningResult = {
  partial: false,
  wordOrder: 'Korean puts thanks last.',
  chunks: [
    {
      ...fact,
      start: 0,
      end: 2,
      text: '오늘',
      gloss: 'today',
      sourceSpans: [{ start: 22, end: 27, text: 'today' }],
    },
    {
      ...fact,
      start: 3,
      end: 7,
      text: '도와줘서',
      gloss: 'for helping me',
      sourceSpans: [{ start: 7, end: 21, text: 'for helping me' }],
    },
    {
      ...fact,
      start: 8,
      end: 12,
      text: '고마워요',
      gloss: 'thanks',
      sourceSpans: [{ start: 0, end: 6, text: 'Thanks' }],
    },
  ],
}
let update: (patch: {
  input?: string
  live?: LiveResult | null
  streaming?: boolean
  isPending?: boolean
}) => void
function Fixture({
  long = false,
  word = false,
  prepared = false,
}: {
  long?: boolean
  word?: boolean
  prepared?: boolean
}) {
  const initialText = word
    ? 'hello'
    : long
      ? Array(8).fill(sourceText).join('\n\n')
      : sourceText
  const initialTranslation = word
    ? '안녕하세요'
    : long
      ? Array(8).fill(translation).join('\n\n')
      : translation
  const [input, setInput] = useState(initialText)
  const [live, setLive] = useState<LiveResult | null>({
    requestSource: 'en',
    text: initialText,
    requestKey: translationRequestKey({
      text: initialText,
      source: 'en',
      target: 'ko',
      mode: 'casual',
      context: '',
      refinements: [],
      uiLang: 'en',
    }),
    done: true,
    ...(word
      ? {
          intent: 'word',
          partial: {
            sourceLang: 'en',
            targetLang: 'ko',
            headword: 'hello',
            primaryTranslation: '안녕하세요',
            posList: [
              {
                pos: 'interjection',
                senses: [
                  {
                    definition: 'A greeting used when meeting someone.',
                    register: [],
                    examples: [],
                  },
                ],
              },
            ],
            synonyms: ['hi'],
            notes: '',
            etymology: '',
            alternativeTranslations: [],
          },
        }
      : {
          intent: 'sentence',
          partial: {
            sourceLang: 'en',
            targetLang: 'ko',
            main: initialTranslation,
            learningPhrases: prepared
              ? analysis.chunks.map((c) => ({
                  text: c.text,
                  gloss: c.gloss,
                  sourceTexts: c.sourceSpans.map((s) => s.text),
                }))
              : undefined,
            rationale: 'A polite, natural thank you.',
            alternatives: [
              { text: '정말 고마워요.', note: 'A warmer thank you.' },
            ],
            learningTips: {
              grammar: 'An ending used when thanking someone.',
              vocab: '',
              characters: [],
            },
          },
        }),
  })
  const [streaming, setStreaming] = useState(false)
  const [isPending, setPending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  update = (p) => {
    if (p.input !== undefined) setInput(p.input)
    if (p.live !== undefined) setLive(p.live)
    if (p.streaming !== undefined) setStreaming(p.streaming)
    if (p.isPending !== undefined) setPending(p.isPending)
  }
  vi.mocked(useTranslatorContext).mockReturnValue({
    input,
    setInput,
    live,
    streaming,
    isPending,
    source: 'en',
    target: 'ko',
    mode: 'casual',
    context: '',
    refinements: [],
    error: null,
    refineError: null,
    detected: 'en',
    intent: live?.intent ?? 'sentence',
    isPolish: false,
    textareaRef,
    setSource: vi.fn(),
    setTarget: vi.fn(),
    setMode: vi.fn(),
    setContext: vi.fn(),
    clearInput: () => {
      setInput('')
      setLive(null)
    },
    flush: () => false,
    queueImmediate: vi.fn(),
    run: vi.fn(),
    reset: vi.fn(),
    lookupWord: vi.fn(),
    addRefinement: vi.fn(),
    removeRefinement: vi.fn(),
  })
  return (
    <UiLangProvider>
      <TranslatorWorkspace />
    </UiLangProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(learn).mockResolvedValue(analysis)
})
test('word details open directly from the translated word without a redundant row or paid request', async () => {
  await render(<Fixture word />)
  expect(document.querySelector('.learning-entry')).toBeNull()
  const referenceLayout = ['workspace', 'split', 'book'].includes(
    document.querySelector('.translator-panels')?.getAttribute('data-layout') ??
      '',
  )
  if (referenceLayout) {
    await expect
      .element(
        page.getByText('A greeting used when meeting someone.', {
          exact: true,
        }),
      )
      .toBeVisible()
    expect(learn).not.toHaveBeenCalled()
  } else expect(document.querySelector('.word-source-meta')).toBeNull()
  const word = page.getByRole('button', { name: 'Word details: 안녕하세요' })
  await word.click()
  await expect
    .element(
      page.getByText('A greeting used when meeting someone.', { exact: true }),
    )
    .toBeVisible()
  expect(document.querySelectorAll('.word-source-meta')).toHaveLength(1)
  expect(learn).not.toHaveBeenCalled()
  expect(document.querySelector('.input-panel textarea')?.textContent).toBe(
    'hello',
  )
  const copy = page
    .getByTestId('output-toolbar')
    .getByRole('button', { name: 'Copy', exact: true })
  await expect.element(copy).toBeEnabled()
  if (document.querySelector('.reference-panel'))
    await expect
      .poll(() =>
        document
          .querySelector('.reference-panel')
          ?.contains(document.activeElement),
      )
      .toBe(true)
  else {
    await page
      .getByRole('button', { name: 'Close learning', exact: true })
      .click()
    expect(document.activeElement).toBe(word.element())
    await userEvent.keyboard('{Enter}')
    await expect
      .element(
        page.getByText('A greeting used when meeting someone.', {
          exact: true,
        }),
      )
      .toBeVisible()
  }
})
test('prepared phrases are available immediately and only explicit More detail starts a learning request', async () => {
  await render(<Fixture prepared />)
  expect(
    document.querySelectorAll('[data-testid="inspectable-phrase"]'),
  ).toHaveLength(3)
  expect(learn).not.toHaveBeenCalled()
  await page.getByTestId('inspectable-phrase').nth(1).click()
  await expect
    .element(page.getByTestId('selected-phrase'))
    .toHaveTextContent('도와줘서')
  await expect
    .element(page.getByText('for helping me', { exact: true }).last())
    .toBeVisible()
  expect(learn).not.toHaveBeenCalled()
  expect(
    page
      .getByTestId('selected-phrase')
      .element()
      .querySelector('.inspectable-phrase'),
  ).toBeNull()
  await page.getByRole('button', { name: 'More detail', exact: true }).click()
  await expect
    .element(
      page.getByText('-어서 gives the reason for the thanks.', { exact: true }),
    )
    .toBeVisible()
  expect(learn).toHaveBeenCalledTimes(1)
})
const mainCopy = () =>
  page
    .getByTestId('output-toolbar')
    .getByRole('button', { name: 'Copy', exact: true })
function visibleRect(element: Element) {
  const r = element.getBoundingClientRect()
  expect(r.left).toBeGreaterThanOrEqual(-1)
  expect(r.right).toBeLessThanOrEqual(window.innerWidth + 1)
  expect(r.top).toBeGreaterThanOrEqual(-1)
  expect(r.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
}
async function settledShot(name: string) {
  await Promise.all(
    [...document.getAnimations()].map((a) => a.finished.catch(() => {})),
  )
  await page.screenshot({
    path: `../../test-results/learning-${window.innerWidth}x${window.innerHeight}-${name}.png`,
  })
}
test('learning is on demand and preserves Copy Paste Clear through overview and phrase detail', async () => {
  await render(<Fixture />)
  expect(learn).not.toHaveBeenCalled()
  await page.getByTestId('breakdown-button').click()
  await expect.element(page.getByTestId('learning-chunk').nth(1)).toBeVisible()
  await page.getByTestId('learning-chunk').nth(1).click()
  await expect
    .element(page.getByTestId('selected-phrase'))
    .toHaveTextContent('도와줘서')
  expect(
    document.querySelector('[data-testid="source-highlight"] mark')
      ?.textContent,
  ).toBe('for helping me')
  const textarea = page
    .getByTestId('input-textarea')
    .element() as HTMLTextAreaElement
  expect(textarea.value).toBe(sourceText)
  visibleRect(mainCopy().element())
  visibleRect(page.getByTestId('paste-input').element())
  visibleRect(page.getByTestId('clear-input').element())
  for (const id of ['paste-input', 'clear-input']) {
    const button = page.getByTestId(id).element()
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    expect(getComputedStyle(button.querySelector('span')!).display).not.toBe(
      'none',
    )
    expect(getComputedStyle(button).flexDirection).toBe('row')
  }
  await settledShot('phrase')
  await page
    .getByRole('button', { name: 'Whole sentence', exact: true })
    .click()
  await expect.element(page.getByTestId('learning-chunk').first()).toBeVisible()
  expect(learn).toHaveBeenCalledTimes(1)
  await settledShot('overview')
  await page.getByTestId('clear-input').click()
  await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
  expect(document.activeElement).toBe(textarea)
  expect(document.querySelector('[data-testid="selected-phrase"]')).toBeNull()
})
test('a deliberate phrase tap selects its chunk without interfering with native selection', async () => {
  await render(<Fixture />)
  const main = page.getByTestId('main-translation').element()
  const range = document.createRange()
  range.setStart(main.firstChild!, 3)
  range.setEnd(main.firstChild!, 7)
  const rect = range.getBoundingClientRect()
  const root = main.getBoundingClientRect()
  await page.getByTestId('main-translation').click({
    position: {
      x: rect.x - root.x + rect.width / 2,
      y: rect.y - root.y + rect.height / 2,
    },
  })
  await expect
    .element(page.getByTestId('selected-phrase'))
    .toHaveTextContent('도와줘서')
  expect(learn).toHaveBeenCalledTimes(1)
  window.getSelection()?.removeAllRanges()
  await userEvent.dblClick(page.getByTestId('main-translation'))
  await new Promise((r) => setTimeout(r, 450))
  expect(learn).toHaveBeenCalledTimes(1)
  window.getSelection()?.removeAllRanges()
})
test('a delayed learning reply cannot reopen after Clear and a failure leaves main actions available', async () => {
  let finish!: (result: LearningResult) => void
  vi.mocked(learn).mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r
      }),
  )
  await render(<Fixture />)
  await page.getByTestId('breakdown-button').click()
  await expect.element(mainCopy()).toBeEnabled()
  await page.getByTestId('clear-input').click()
  finish(analysis)
  await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
  expect(document.querySelector('[data-testid="selected-phrase"]')).toBeNull()
})
test('learning failures expose explicit retry while native source editing keeps its cursor', async () => {
  vi.mocked(learn).mockRejectedValueOnce(new Error('private provider contents'))
  await render(<Fixture />)
  const textarea = page
    .getByTestId('input-textarea')
    .element() as HTMLTextAreaElement
  textarea.focus()
  textarea.setSelectionRange(3, 8)
  await page.getByTestId('breakdown-button').click()
  await expect
    .element(page.getByRole('button', { name: 'Retry', exact: true }))
    .toBeVisible()
  expect(document.body.textContent).not.toContain('private provider')
  expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 8])
  await expect.element(mainCopy()).toBeEnabled()
  expect(learn).toHaveBeenCalledTimes(1)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.element(page.getByTestId('learning-chunk').first()).toBeVisible()
  update({ input: 'Next message' })
  await expect.element(mainCopy()).toBeDisabled()
  expect(document.querySelector('[data-testid="selected-phrase"]')).toBeNull()
})

test('long results keep primary actions visible through incremental keyboard shrink and pan', async () => {
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetTop: 0,
    scale: 1,
  })
  const initialHeight = window.innerHeight
  vi.stubGlobal('visualViewport', viewport)
  document.documentElement.style.setProperty('--safe-area-bottom', '20px')
  try {
    await render(<Fixture long />)
    const editor = page
      .getByTestId('input-textarea')
      .element() as HTMLTextAreaElement
    await page.getByTestId('breakdown-button').click()
    await expect
      .element(page.getByTestId('learning-chunk').nth(1))
      .toBeVisible()
    await page.getByTestId('learning-chunk').nth(1).click()
    editor.focus()
    editor.setSelectionRange(2, 8)
    for (const ratio of [0.85, 0.7, 0.55]) {
      viewport.height = Math.floor(initialHeight * ratio)
      viewport.dispatchEvent(new Event('resize'))
      await new Promise(requestAnimationFrame)
    }
    viewport.offsetTop = 12
    viewport.dispatchEvent(new Event('scroll'))
    await expect
      .poll(() =>
        document.querySelector('.app-shell')?.hasAttribute('data-keyboard'),
      )
      .toBe(true)
    for (const control of [
      mainCopy().element(),
      page.getByTestId('paste-input').element(),
      page.getByTestId('clear-input').element(),
    ]) {
      const rect = control.getBoundingClientRect()
      expect(rect.top).toBeGreaterThanOrEqual(viewport.offsetTop - 1)
      expect(rect.bottom).toBeLessThanOrEqual(
        viewport.height + viewport.offsetTop + 1,
      )
    }
    expect(page.getByTestId('input-textarea').element()).toBe(editor)
    expect(document.activeElement).toBe(editor)
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 8])
    const panel = document.querySelector<HTMLElement>('.learning-panel')
    if (panel && !panel.hidden)
      expect(
        panel.querySelector('.learning-panel-body')?.hasAttribute('hidden'),
      ).toBe(true)
    await settledShot('keyboard')
  } finally {
    document.documentElement.style.removeProperty('--safe-area-bottom')
    vi.unstubAllGlobals()
  }
})

test.each([440, 320])(
  'learning can be deliberately restored at a short %s-pixel portrait height',
  async (height) => {
    const original = [window.innerWidth, window.innerHeight] as const
    try {
      await page.viewport(382, height)
      await render(<Fixture />)
      await page.getByTestId('breakdown-button').click()
      const show = page.getByRole('button', {
        name: 'Show learning',
        exact: true,
      })
      if (show.query()) await show.click()
      await expect
        .element(page.getByTestId('learning-chunk').nth(1))
        .toBeVisible()
      await page.getByTestId('learning-chunk').nth(1).click()
      await expect
        .element(
          page.getByRole('button', { name: 'Whole sentence', exact: true }),
        )
        .toBeVisible()
      if (height === 320)
        expect(
          document.querySelector('.learning-panel')?.closest('.result-scroll'),
        ).not.toBeNull()
      for (const control of [
        mainCopy().element(),
        page.getByTestId('paste-input').element(),
        page.getByTestId('clear-input').element(),
      ])
        visibleRect(control)
      await settledShot('short-restore')
    } finally {
      await page.viewport(...original)
    }
  },
)

test('deselecting native text and a long press do not initiate paid inspection', async () => {
  await render(<Fixture />)
  // Focus the application frame before creating a native selection. Otherwise
  // Playwright's first focus transfer can clear it before pointerdown arrives.
  await page
    .getByTestId('translation-result')
    .click({ position: { x: 1, y: 1 } })
  await Promise.all(
    [...document.getAnimations()]
      .filter((a) =>
        Number.isFinite(a.effect?.getComputedTiming().endTime ?? 0),
      )
      .map((a) => a.finished.catch(() => {})),
  )
  await new Promise(requestAnimationFrame)
  const main = page.getByTestId('main-translation').element()
  const range = document.createRange()
  range.selectNodeContents(main)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  expect(window.getSelection()?.toString()).not.toBe('')
  const selectedAtDown: boolean[] = []
  document.addEventListener(
    'pointerdown',
    () => selectedAtDown.push(Boolean(window.getSelection()?.toString())),
    { capture: true, once: true },
  )
  await page.getByTestId('main-translation').click()
  await new Promise((r) => setTimeout(r, 450))
  expect(selectedAtDown).toEqual([true])
  expect(learn).not.toHaveBeenCalled()
  window.getSelection()?.removeAllRanges()
  await page.getByTestId('main-translation').click({ delay: 600 })
  await new Promise((r) => setTimeout(r, 450))
  expect(learn).not.toHaveBeenCalled()
  window.getSelection()?.removeAllRanges()
})
