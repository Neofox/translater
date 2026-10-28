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
const noRefinements: string[] = []
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
  error?: { kind: 'server'; message: string } | null
}) => void
function Fixture({
  long = false,
  word = false,
  prepared = false,
  reading = false,
  uiLang = 'en',
}: {
  long?: boolean
  word?: boolean
  prepared?: boolean
  reading?: boolean
  uiLang?: 'en' | 'ko'
}) {
  const sourceLanguage = reading ? 'ko' : 'en'
  const targetLanguage = reading ? 'en' : 'ko'
  const learnsKorean = uiLang === 'en'
  const phraseMap = learnsKorean
    ? analysis.chunks.map((c) => ({
        text: c.text,
        gloss: c.gloss,
        sourceTexts: c.sourceSpans.map((s) => s.text),
      }))
    : analysis.chunks
        .flatMap((c) =>
          c.sourceSpans.map((span) => ({
            ...span,
            gloss: c.text,
            sourceTexts: [c.text],
          })),
        )
        .sort((a, b) => a.start - b.start)
        .map(({ text, gloss, sourceTexts }) => ({ text, gloss, sourceTexts }))
  const initialText = word
    ? 'hello'
    : reading
      ? translation
      : long
        ? Array(8).fill(sourceText).join('\n\n')
        : sourceText
  const initialTranslation = word
    ? '안녕하세요'
    : reading
      ? sourceText
      : long
        ? Array(8).fill(translation).join('\n\n')
        : translation
  const [input, setInput] = useState(initialText)
  const [live, setLive] = useState<LiveResult | null>({
    requestSource: sourceLanguage,
    text: initialText,
    requestKey: translationRequestKey({
      text: initialText,
      source: sourceLanguage,
      target: targetLanguage,
      mode: 'casual',
      context: '',
      refinements: [],
      uiLang,
    }),
    done: true,
    ...(word
      ? {
          intent: 'word',
          partial: {
            sourceLang: sourceLanguage,
            targetLang: targetLanguage,
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
            sourceLang: sourceLanguage,
            targetLang: targetLanguage,
            main: initialTranslation,
            learningPhrases: prepared ? phraseMap : undefined,
            rationale: 'A polite, natural thank you.',
            alternatives: [
              {
                text: reading
                  ? 'I really appreciate your help today.'
                  : '정말 고마워요.',
                note: 'A warmer thank you.',
              },
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
  const [error, setError] = useState<{
    kind: 'server'
    message: string
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  update = (p) => {
    if (p.input !== undefined) setInput(p.input)
    if (p.live !== undefined) setLive(p.live)
    if (p.streaming !== undefined) setStreaming(p.streaming)
    if (p.isPending !== undefined) setPending(p.isPending)
    if (p.error !== undefined) setError(p.error)
  }
  vi.mocked(useTranslatorContext).mockReturnValue({
    input,
    setInput,
    live,
    streaming,
    isPending,
    source: sourceLanguage,
    target: targetLanguage,
    mode: 'casual',
    context: '',
    refinements: noRefinements,
    error,
    refineError: null,
    detected: sourceLanguage,
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
test('English UI breaks down original Korean when translating into English', async () => {
  await render(<Fixture reading prepared />)
  const main = page.getByTestId('main-translation').element()
  expect(main.textContent).toBe(sourceText)
  expect(main.hasAttribute('data-inspectable')).toBe(false)
  expect(main.querySelector('[data-testid="inspectable-phrase"]')).toBeNull()
  if (page.getByTestId('breakdown-button').query())
    await page.getByTestId('breakdown-button').click()
  const row = page.getByTestId('learning-chunk').nth(1)
  await expect.element(row).toBeVisible()
  expect(row.element().textContent).toContain('도와줘서')
  const editor = page
    .getByTestId('input-textarea')
    .element() as HTMLTextAreaElement
  await row.click()
  await expect
    .poll(() =>
      document
        .querySelector('[data-testid="source-highlight"]')
        ?.textContent.replace(/\u200b/g, ''),
    )
    .toBe(translation)
  expect(
    document.querySelector('[data-testid="source-highlight"] mark')
      ?.textContent,
  ).toBe('도와줘서')
  expect(document.querySelector('.learning-phrase')?.getAttribute('lang')).toBe(
    'ko',
  )
  expect(editor.value).toBe(translation)
  expect(learn).not.toHaveBeenCalled()
  await settledShot('source-language-breakdown')
  await page.getByRole('button', { name: 'More detail', exact: true }).click()
  await expect
    .element(page.getByText(fact.grammar, { exact: true }))
    .toBeVisible()
  expect(vi.mocked(learn).mock.calls[0]?.[0].data).toMatchObject({
    side: 'source',
    text: translation,
    translation: sourceText,
    source: 'ko',
    target: 'en',
    sentenceStart: 0,
    sentenceEnd: translation.length,
    uiLang: 'en',
  })
  visibleRect(mainCopy().element())
  visibleRect(page.getByTestId('clear-input').element())
})

test('Korean UI breaks down original English when translating into Korean', async () => {
  localStorage.setItem('ui-lang', 'ko')
  await render(<Fixture prepared uiLang="ko" />)
  if (page.getByTestId('breakdown-button').query())
    await page.getByTestId('breakdown-button').click()
  await expect.element(page.getByTestId('learning-chunk').first()).toBeVisible()
  expect(
    page.getByTestId('learning-chunk').first().element().textContent,
  ).toContain('Thanks')
  expect(
    page
      .getByTestId('main-translation')
      .element()
      .hasAttribute('data-inspectable'),
  ).toBe(false)
  await page.getByTestId('learning-chunk').first().click()
  await expect
    .poll(
      () =>
        document.querySelector('[data-testid="source-highlight"] mark')
          ?.textContent,
    )
    .toBe('Thanks')
  expect(document.querySelector('.learning-phrase')?.getAttribute('lang')).toBe(
    'en',
  )
  expect(learn).not.toHaveBeenCalled()
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
  if (document.querySelector('.reference-panel'))
    expect(
      document.querySelector('[data-testid="breakdown-button"]'),
    ).toBeNull()
  else await expect.element(page.getByTestId('breakdown-button')).toBeVisible()
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
  let finishDetails!: (value: LearningResult) => void
  vi.mocked(learn).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishDetails = resolve
      }),
  )
  await page.getByRole('button', { name: 'More detail', exact: true }).click()
  await expect
    .element(page.getByRole('status'))
    .toHaveTextContent('Loading more detail…')
  await expect
    .element(page.getByTestId('learning-detail-skeleton'))
    .toBeVisible()
  await expect
    .element(page.getByText('for helping me', { exact: true }).last())
    .toBeVisible()
  await settledShot('detail-loading')
  finishDetails(analysis)
  await expect
    .element(
      page.getByText('-어서 gives the reason for the thanks.', { exact: true }),
    )
    .toBeVisible()
  expect(learn).toHaveBeenCalledTimes(1)
})
test('adjustments stay with tone in the header and expose chips when there is room', async () => {
  await render(<Fixture prepared />)
  const toolbar = document.querySelector('.app-header')!
  const adjust = page.getByTestId('adjust-button')
  const softer = page.getByTestId('refine-chip-softer')
  const inline = document
    .querySelector('.adjust-menu')
    ?.hasAttribute('data-inline')
  await settledShot('header-adjustments-default')
  if (window.innerWidth >= 1100) expect(inline).toBe(true)
  if (inline) {
    await expect.element(softer).toBeVisible()
    await expect.element(adjust).not.toBeVisible()
    const tone = page
      .getByTestId('settings-button')
      .element()
      .getBoundingClientRect()
    const chip = softer.element().getBoundingClientRect()
    expect(Math.abs(chip.top - tone.top)).toBeLessThanOrEqual(2)
  } else {
    await expect.element(adjust).toBeVisible()
    expect(toolbar.contains(adjust.element())).toBe(true)
    const tone = page
      .getByTestId('settings-button')
      .element()
      .getBoundingClientRect()
    expect(
      Math.abs(adjust.element().getBoundingClientRect().top - tone.top),
    ).toBeLessThanOrEqual(2)
    await adjust.click()
    await expect.element(softer).toBeVisible()
  }
  await settledShot('inline-adjustments')
  await page.getByTestId('refine-custom-trigger').click()
  const field = page.getByTestId('refine-freeform')
  await field.fill('gentler please')
  const node = field.element()
  expect(page.getByTestId('output-toolbar').element().contains(node)).toBe(
    false,
  )
  if (inline) {
    const content = document.querySelector<HTMLElement>('.app-settings')!
    content.style.maxWidth = '450px'
    await expect.element(adjust).toBeVisible()
    await expect.element(field).toBeVisible()
    expect(field.element()).toBe(node)
    content.style.maxWidth = ''
    await expect.element(adjust).not.toBeVisible()
  }
  await expect.element(field).toHaveValue('gentler please')
  if (!inline) {
    const panel = document.querySelector('.adjust-content[data-open]')!
    expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      document.querySelector('.translator-panels')!.getBoundingClientRect().top,
    )
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
    const source = page
      .getByTestId('input-textarea')
      .element()
      .getBoundingClientRect()
    const actions = document
      .querySelector('.composer-actions')!
      .getBoundingClientRect()
    expect(source.top + 24).toBeLessThanOrEqual(actions.top)
    if (window.innerHeight < 460 && window.innerWidth >= 560)
      expect(source.bottom).toBeLessThanOrEqual(actions.top)
  }
  visibleRect(mainCopy().element())
  visibleRect(page.getByTestId('clear-input').element())
  await settledShot('inline-adjustments-custom')
  if (!inline) {
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await mainCopy().click()
    expect(copy).toHaveBeenCalledWith(translation)
    await expect.element(adjust).toHaveAttribute('aria-expanded', 'false')
    copy.mockRestore()
  }
})
test('adjustment width measurement reconnects after an error and same-sentence retry', async () => {
  await render(<Fixture prepared />)
  update({ error: { kind: 'server', message: 'Unavailable' } })
  await expect
    .element(page.getByTestId('refine-chip-softer'))
    .not.toBeInTheDocument()
  update({ error: null })
  await expect
    .element(page.getByTestId('refine-chip-softer'))
    .toBeInTheDocument()
  document.querySelector<HTMLElement>('.app-settings')!.style.maxWidth = '450px'
  await expect.element(page.getByTestId('adjust-button')).toBeVisible()
  expect(
    document.querySelector('.adjust-menu')?.hasAttribute('data-inline'),
  ).toBe(false)
  await page.getByTestId('adjust-button').click()
  await expect.element(page.getByTestId('refine-chip-softer')).toBeVisible()
})
test('opening Custom with phrase details already open keeps Copy clickable', async () => {
  if (window.innerWidth >= 560) return
  await render(<Fixture prepared />)
  await page.getByTestId('inspectable-phrase').first().click()
  await expect.element(page.getByTestId('learning-inspector')).toBeVisible()
  await page.getByTestId('adjust-button').click()
  await page.getByTestId('refine-custom-trigger').click()
  await page.getByTestId('refine-freeform').fill('gentler please')
  const copy = mainCopy().element()
  await expect
    .poll(() => {
      const r = copy.getBoundingClientRect()
      return (
        document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest('button') === copy
      )
    })
    .toBe(true)
  await settledShot('combined-learning-adjust')
  await page.getByRole('button', { name: 'Show learning', exact: true }).click()
  await expect.element(page.getByTestId('refine-freeform')).not.toBeVisible()
  await expect.element(page.getByTestId('learning-inspector')).toBeVisible()
})
test('header custom adjustments keep keyboard focus and restore the source keyboard layout', async () => {
  if (window.innerWidth >= 500 || window.innerHeight < 450) return
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetTop: 0,
    scale: 1,
  })
  const initialHeight = window.innerHeight
  vi.stubGlobal('visualViewport', viewport)
  try {
    await render(<Fixture prepared />)
    await page.getByTestId('adjust-button').click()
    await page.getByTestId('refine-custom-trigger').click()
    const field = page.getByTestId('refine-freeform')
    await field.fill('gentler please')
    for (const ratio of [0.85, 0.7, 0.55]) {
      viewport.height =
        ratio === 0.55
          ? Math.min(319, Math.floor(initialHeight * ratio))
          : Math.floor(initialHeight * ratio)
      viewport.dispatchEvent(new Event('resize'))
      await new Promise(requestAnimationFrame)
    }
    await expect.element(field).toBeVisible()
    expect(document.activeElement).toBe(field.element())
    await expect.element(field).toHaveValue('gentler please')
    expect(
      page
        .getByTestId('adjust-button')
        .element()
        .closest('.app-header')
        ?.getBoundingClientRect().bottom,
    ).toBeLessThan(viewport.height)
    const fieldBox = field.element().getBoundingClientRect()
    const composerBox = document
      .querySelector('.input-panel')!
      .getBoundingClientRect()
    expect(fieldBox.bottom).toBeLessThanOrEqual(composerBox.top)
    const copyBox = mainCopy().element().getBoundingClientRect()
    expect(copyBox.top).toBeGreaterThanOrEqual(fieldBox.bottom)
    expect(copyBox.bottom).toBeLessThanOrEqual(composerBox.top)
    const mainBox = page
      .getByTestId('main-translation')
      .element()
      .getBoundingClientRect()
    expect(mainBox.top).toBeGreaterThanOrEqual(fieldBox.bottom)
    expect(mainBox.top + 24).toBeLessThanOrEqual(copyBox.top)
    for (const id of ['refine-apply', 'refine-close']) {
      const box = page.getByTestId(id).element().getBoundingClientRect()
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.right).toBeLessThanOrEqual(window.innerWidth)
      expect(box.bottom).toBeLessThanOrEqual(fieldBox.bottom + 2)
    }
    await settledShot('header-adjust-keyboard')
    await page.getByTestId('refine-close').click()
    await expect.element(field).not.toBeVisible()
    await expect
      .poll(() => document.activeElement)
      .toBe(page.getByTestId('input-textarea').element())
    viewport.height = initialHeight
    viewport.dispatchEvent(new Event('resize'))
    await new Promise(requestAnimationFrame)
    await page.getByTestId('adjust-button').click()
    await page.getByTestId('refine-custom-trigger').click()
    await expect.element(field).toHaveValue('gentler please')
    await expect.poll(() => document.activeElement).toBe(field.element())
    await userEvent.keyboard('{Escape}')
    const editor = page
      .getByTestId('input-textarea')
      .element() as HTMLTextAreaElement
    editor.focus()
    viewport.height = Math.min(319, Math.floor(initialHeight * 0.55))
    viewport.dispatchEvent(new Event('resize'))
    await new Promise(requestAnimationFrame)
    await expect
      .poll(
        () => getComputedStyle(document.querySelector('.app-header')!).display,
      )
      .toBe('none')
    expect(
      mainCopy().element().getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(viewport.height)
    visibleRect(mainCopy().element())
    visibleRect(page.getByTestId('clear-input').element())
  } finally {
    vi.unstubAllGlobals()
    window.dispatchEvent(new Event('resize'))
  }
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
    [...document.getAnimations()]
      .filter((a) =>
        Number.isFinite(a.effect?.getComputedTiming().endTime ?? 0),
      )
      .map((a) => a.finished.catch(() => {})),
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
