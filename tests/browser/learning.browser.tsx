import { useRef, useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import TranslatorWorkspace from '../../src/components/TranslatorWorkspace'
import { useTranslatorContext } from '../../src/context/TranslatorContext'
import { UiLangProvider } from '../../src/hooks/useUiLang'
import { translationRequestKey } from '../../src/lib/translationRequestKey'
import type { LiveResult } from '../../src/hooks/useTranslate'
import type { LearningResult } from '../../src/server/learningTypes'

vi.mock('../../src/context/TranslatorContext', () => ({
  useTranslatorContext: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))
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
  prepared = true,
  reading = false,
  uiLang = 'en',
  noAlternatives = false,
}: {
  long?: boolean
  word?: boolean
  prepared?: boolean
  reading?: boolean
  uiLang?: 'en' | 'ko'
  noAlternatives?: boolean
}) {
  const sourceLanguage = reading ? 'ko' : 'en'
  const targetLanguage = reading ? 'en' : 'ko'
  const learnsKorean = uiLang === 'en'
  const phraseMap = learnsKorean
    ? analysis.chunks.map((c, index) => ({
        text: c.text,
        gloss: c.gloss,
        sourceTexts: c.sourceSpans.map((s) => s.text),
        baseForm: index === 0 ? '오늘' : index === 1 ? '도와주다' : '고맙다',
        literalMeaning:
          index === 0
            ? 'today'
            : index === 1
              ? 'because you helped'
              : 'to be grateful',
        naturalMeaning: c.gloss,
        grammar:
          index === 0
            ? ''
            : index === 1
              ? fact.grammar
              : '고마워요 is the polite present form of 고맙다.',
        omissions:
          index === 0 ? '' : 'The participants are understood from context.',
        usageNote:
          index === 1 ? '도와주다 emphasizes helping another person.' : '',
        characters: [],
        grammarHighlights:
          index === 0 ? [] : index === 1 ? ['줘서'] : ['고마워요'],
      }))
    : analysis.chunks
        .flatMap((c) =>
          c.sourceSpans.map((span) => ({
            ...span,
            gloss: c.text,
            sourceTexts: [c.text],
            baseForm: '',
            literalMeaning: '',
            naturalMeaning: '',
            grammar:
              span.text === 'for helping me'
                ? 'for + 동명사 helping은 감사하는 이유를 나타냅니다.'
                : '',
            omissions: '',
            usageNote: '',
            characters: [],
            grammarHighlights:
              span.text === 'for helping me' ? ['for helping'] : [],
          })),
        )
        .sort((a, b) => a.start - b.start)
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
            grammar: 'A polite greeting.',
            characters: [],
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
            learningPhrases: prepared
              ? long
                ? Array.from({ length: 8 }, () => phraseMap).flat()
                : phraseMap
              : undefined,
            rationale: 'A polite, natural thank you.',
            alternatives: noAlternatives
              ? []
              : [
                  {
                    text: reading
                      ? 'I really appreciate your help today.'
                      : '정말 고마워요.',
                    note: 'A warmer thank you.',
                  },
                ],
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
async function openOverview() {
  if (
    !document.querySelector('.learning-panel') &&
    !document.querySelector('.app-shell[data-desktop]')
  )
    await page.getByTestId('main-translation').click()
  if (!document.querySelector('.app-shell[data-desktop]'))
    await expect.element(page.getByTestId('learning-panel')).toBeVisible()
  const rows = [...document.querySelectorAll('[data-testid="learning-chunk"]')]
  const selected = rows.findIndex(
    (row) => row.getAttribute('aria-expanded') === 'true',
  )
  if (selected >= 0)
    await page.getByTestId('learning-chunk').nth(selected).click()
}
beforeEach(() => {
  vi.clearAllMocks()
})

test.each([
  { word: false, reading: false },
  { word: false, reading: true },
  { word: true, reading: false },
])(
  'details stay with their phrase or dictionary entry beside source (%j)',
  async ({ word, reading }) => {
    await render(
      <Fixture prepared word={word} reading={reading} noAlternatives />,
    )
    const desktop =
      document
        .querySelector('.translator-panels')
        ?.getAttribute('data-layout') === 'workspace'
    if (!desktop && !document.querySelector('.reference-panel')) {
      if (word) await page.getByTestId('word-details-trigger').click()
      else await openOverview()
    }
    expect(document.querySelector('.detail-learning')).toBeNull()
    expect(
      page.getByRole('heading', { name: 'Learning tips', exact: true }).query(),
    ).toBeNull()
    if (desktop) {
      const source = page
        .getByTestId('input-textarea')
        .element() as HTMLTextAreaElement
      const area = document.querySelector('.source-input-area')!
      expect(getComputedStyle(area).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(area).borderRadius).toBe('0px')
      expect(
        Math.abs(
          source.getBoundingClientRect().left -
            document.querySelector('.composer-header')!.getBoundingClientRect()
              .left,
        ),
      ).toBeLessThanOrEqual(1)
      source.focus()
      source.setSelectionRange(1, 3)
      expect(
        getComputedStyle(document.querySelector('.composer')!).boxShadow,
      ).not.toBe('none')
      if (!word) {
        expect(
          document.querySelector(
            '.reference-panel [data-testid="learning-chunk"]',
          ),
        ).not.toBeNull()
        await page.getByTestId('learning-chunk').first().click()
        expect(
          document.querySelectorAll('[data-testid="learning-chunk"]'),
        ).toHaveLength(3)
        expect(page.getByTestId('input-textarea').element()).toBe(source)
        expect([source.selectionStart, source.selectionEnd]).toEqual([1, 3])
      } else
        expect(
          document.querySelector('.reference-panel .word-source-meta'),
        ).not.toBeNull()
      await settledShot(
        `balanced-learning-${word ? 'word' : reading ? 'source' : 'target'}`,
      )
    }
  },
)
test('English UI breaks down original Korean when translating into English', async () => {
  await render(<Fixture reading prepared />)
  const main = page.getByTestId('main-translation').element()
  expect(main.textContent).toBe(sourceText)
  expect(main.hasAttribute('data-inspectable')).toBe(
    !document.querySelector('.app-shell[data-desktop]'),
  )
  expect(main.querySelector('[data-testid="inspectable-phrase"]')).toBeNull()
  await openOverview()
  const row = page.getByTestId('learning-chunk').nth(1)
  await expect.element(row).toBeVisible()
  expect(row.element().textContent).toContain('도와줘서')
  const editor = page
    .getByTestId('input-textarea')
    .element() as HTMLTextAreaElement
  await row.click()
  if (document.querySelector('.app-shell[data-desktop]')) {
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
  }
  expect(document.querySelector('.learning-phrase')?.getAttribute('lang')).toBe(
    'ko',
  )
  expect(editor.value).toBe(translation)
  await settledShot('source-language-breakdown')
  await expect
    .element(page.getByText(fact.grammar, { exact: true }))
    .toBeVisible()
  visibleRect(mainCopy().element())
  if (page.getByTestId('learning-panel').query())
    await page
      .getByRole('button', { name: 'Close learning', exact: true })
      .click()
  visibleRect(page.getByTestId('clear-input').element())
})

test('Korean UI breaks down original English when translating into Korean', async () => {
  localStorage.setItem('ui-lang', 'ko')
  await render(<Fixture prepared uiLang="ko" />)
  await openOverview()
  await expect.element(page.getByTestId('learning-chunk').first()).toBeVisible()
  expect(
    page.getByTestId('learning-chunk').first().element().textContent,
  ).toContain('Thanks')
  expect(
    page
      .getByTestId('main-translation')
      .element()
      .hasAttribute('data-inspectable'),
  ).toBe(!document.querySelector('.app-shell[data-desktop]'))
  await page.getByTestId('learning-chunk').first().click()
  if (document.querySelector('.app-shell[data-desktop]')) {
    await expect
      .poll(
        () =>
          document.querySelector('[data-testid="source-highlight"] mark')
            ?.textContent,
      )
      .toBe('Thanks')
  }
  expect(document.querySelector('.learning-phrase')?.getAttribute('lang')).toBe(
    'en',
  )
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
  } else expect(document.querySelector('.word-source-meta')).toBeNull()
  const word = page.getByRole('button', { name: 'Word details: 안녕하세요' })
  // Earlier clicks may leave the pointer over this newly mounted target.
  await word.unhover()
  const wordStyle = getComputedStyle(word.element())
  expect(wordStyle.color).toBe(
    getComputedStyle(page.getByTestId('main-translation').element()).color,
  )
  if (referenceLayout) expect(wordStyle.textDecorationLine).toBe('none')
  await word.click()
  await expect
    .element(
      page.getByText('A greeting used when meeting someone.', { exact: true }),
    )
    .toBeVisible()
  expect(document.querySelectorAll('.word-source-meta')).toHaveLength(1)
  expect(document.querySelector('.input-panel textarea')?.textContent).toBe(
    'hello',
  )
  const copy = page
    .getByTestId('output-toolbar')
    .getByRole('button', { name: 'Copy', exact: true })
  await expect.element(copy).toBeEnabled()
  if (document.querySelector('.app-shell[data-desktop]')) {
    await expect
      .poll(() =>
        document
          .querySelector('.reference-panel')
          ?.contains(document.activeElement),
      )
      .toBe(true)
    await copy.click()
    await word.click()
    await expect
      .poll(() =>
        document
          .querySelector('.reference-panel')
          ?.contains(document.activeElement),
      )
      .toBe(true)
    word.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() =>
        document.activeElement?.classList.contains('reference-heading'),
      )
      .toBe(true)
    await settledShot('word-dictionary-focused')
  } else {
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
test('initial phrase details reveal locally and only grammar constructions are underlined', async () => {
  await render(<Fixture prepared />)
  expect(
    [...document.querySelectorAll('[data-testid="inspectable-phrase"]')].map(
      (e) => e.textContent,
    ),
  ).toEqual(['줘서', '고마워요'])
  expect(page.getByTestId('main-translation').element().textContent).toBe(
    translation,
  )
  await page.getByTestId('inspectable-phrase').first().click()
  await expect
    .element(page.getByTestId('selected-phrase'))
    .toHaveTextContent('도와줘서')
  await expect
    .element(page.getByText(fact.grammar, { exact: true }))
    .toBeVisible()
  await expect
    .element(page.getByText('도와주다', { exact: true }))
    .toBeVisible()
  expect(
    page.getByRole('button', { name: 'More detail', exact: true }).query(),
  ).toBeNull()
  expect(
    document.querySelector('[data-testid="learning-detail-skeleton"]'),
  ).toBeNull()
  visibleRect(mainCopy().element())
  await settledShot('inline-phrase-details')
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
    expect(panel.hasAttribute('data-overlay')).toBe(true)
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
    const source = page
      .getByTestId('input-textarea')
      .element()
      .getBoundingClientRect()
    const actions = document
      .querySelector('.composer-actions')!
      .getBoundingClientRect()
    if (actions.bottom <= source.top) {
      expect(actions.bottom).toBeLessThanOrEqual(source.top)
    } else expect(source.top + 24).toBeLessThanOrEqual(actions.top)
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
  await page
    .getByRole('button', { name: 'Close learning', exact: true })
    .click()
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
  await page.getByTestId('adjust-button').click()
  await page.getByTestId('main-translation').click()
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
test('initial phrase details preserve Copy Paste Clear through overview and inspection', async () => {
  await render(<Fixture />)
  await openOverview()
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
  if (page.getByTestId('learning-panel').query())
    await page
      .getByRole('button', { name: 'Close learning', exact: true })
      .click()
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
  await openOverview()
  await expect.element(page.getByTestId('learning-chunk').first()).toBeVisible()
  await settledShot('overview')
  if (page.getByTestId('learning-panel').query())
    await page
      .getByRole('button', { name: 'Close learning', exact: true })
      .click()
  await page.getByTestId('clear-input').click()
  await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
  expect(document.activeElement).toBe(textarea)
  expect(document.querySelector('[data-testid="selected-phrase"]')).toBeNull()
})
test('a deliberate phrase tap selects its chunk without interfering with native selection', async () => {
  await render(<Fixture />)
  await page.getByTestId('inspectable-phrase').first().click()
  await expect
    .element(page.getByTestId('selected-phrase'))
    .toHaveTextContent('도와줘서')
  if (page.getByTestId('learning-panel').query())
    await page
      .getByRole('button', { name: 'Close learning', exact: true })
      .click()
  window.getSelection()?.removeAllRanges()
  await userEvent.dblClick(page.getByTestId('main-translation'))
  await new Promise((r) => setTimeout(r, 450))
  window.getSelection()?.removeAllRanges()
})
test('initial phrase inspection clears on input edits, translation errors and Clear', async () => {
  await render(<Fixture />)
  await openOverview()
  await page.getByTestId('learning-chunk').nth(1).click()
  await expect
    .element(page.getByTestId('selected-phrase'))
    .toHaveTextContent('도와줘서')
  update({ input: 'An edited message' })
  await expect.element(mainCopy()).toBeDisabled()
  expect(document.querySelector('[data-testid="selected-phrase"]')).toBeNull()
  update({ input: sourceText })
  await openOverview()
  await page.getByTestId('learning-chunk').nth(1).click()
  update({ error: { kind: 'server', message: 'Unavailable' } })
  await expect.element(mainCopy()).toBeDisabled()
  expect(document.querySelector('[data-testid="selected-phrase"]')).toBeNull()
  update({ error: null })
  await page.getByTestId('clear-input').click()
  await expect.element(page.getByTestId('input-textarea')).toHaveValue('')
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
    await openOverview()
    await expect
      .element(page.getByTestId('learning-chunk').nth(1))
      .toBeVisible()
    await page.getByTestId('learning-chunk').nth(1).click()
    if (page.getByTestId('learning-panel').query())
      await page
        .getByRole('button', { name: 'Close learning', exact: true })
        .click()
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
    expect(document.querySelector('.learning-panel')).toBeNull()
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
      await openOverview()
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
        .element(page.getByTestId('learning-chunk').nth(1))
        .toBeVisible()
      visibleRect(mainCopy().element())
      expect(
        page.getByTestId('learning-panel').element().getBoundingClientRect()
          .height,
      ).toBeGreaterThan(height * 0.7)
      await page
        .getByRole('button', { name: 'Close learning', exact: true })
        .click()
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

test('deselecting native text and a long press do not inspect grammar', async () => {
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
  expect(document.querySelector('[data-testid="selected-phrase"]')).toBeNull()
  window.getSelection()?.removeAllRanges()
  await page.getByTestId('main-translation').click({ delay: 600 })
  await new Promise((r) => setTimeout(r, 450))
  window.getSelection()?.removeAllRanges()
})

test('whole-message breakdown keeps every phrase visible with inline details and no sentence pagination', async () => {
  await render(<Fixture long prepared />)
  await openOverview()
  await expect
    .poll(
      () => document.querySelectorAll('[data-testid="learning-chunk"]').length,
    )
    .toBe(24)
  expect(document.querySelector('.learning-sentences')).toBeNull()
  const rows = page.getByTestId('learning-chunk')
  await rows.nth(4).click()
  await expect.element(rows.nth(4)).toHaveAttribute('aria-expanded', 'true')
  expect(
    document.querySelectorAll('[data-testid="learning-chunk"]'),
  ).toHaveLength(24)
  expect(document.querySelectorAll('.phrase-detail')).toHaveLength(1)
  await expect
    .element(
      page.getByText('도와주다 emphasizes helping another person.', {
        exact: true,
      }),
    )
    .toBeVisible()
  await rows.nth(7).click()
  await expect.element(rows.nth(7)).toHaveAttribute('aria-expanded', 'true')
  await expect.element(rows.nth(4)).toHaveAttribute('aria-expanded', 'false')
  expect(document.querySelectorAll('.phrase-detail')).toHaveLength(1)
  await rows.nth(7).click()
  expect(document.querySelector('.phrase-detail')).toBeNull()
  expect(
    document.querySelectorAll('[data-testid="learning-chunk"]'),
  ).toHaveLength(24)
})

test('desktop Adjust overlays without growing the header or covering primary actions', async () => {
  if (window.innerWidth < 1100) return
  await render(<Fixture prepared />)
  const original = [window.innerWidth, window.innerHeight] as const
  try {
    for (const width of [1280, 1512, 2048]) {
      await page.viewport(width, 982)
      const header = document.querySelector('.app-header')!
      const before = header.getBoundingClientRect()
      const actions = [
        mainCopy().element(),
        page.getByTestId('paste-input').element(),
      ]
      const boxes = actions.map((node) => node.getBoundingClientRect())
      await page.getByTestId('adjust-button').click()
      await expect.element(page.getByTestId('refine-chip-softer')).toBeVisible()
      await expect
        .poll(() =>
          Math.abs(header.getBoundingClientRect().height - before.height),
        )
        .toBeLessThanOrEqual(1)
      const panel = document.querySelector('.adjust-content[data-open]')!
      const box = panel.getBoundingClientRect()
      expect(box.top).toBeGreaterThanOrEqual(before.bottom - 2)
      actions.forEach((node, index) => {
        const current = node.getBoundingClientRect()
        expect(Math.abs(current.top - boxes[index]!.top)).toBeLessThanOrEqual(1)
        expect(
          document
            .elementFromPoint(
              current.left + current.width / 2,
              current.top + current.height / 2,
            )
            ?.closest('button'),
        ).toBe(node)
      })
      await settledShot(`adjust-overlay-${width}`)
      await page.getByTestId('adjust-button').click()
    }
  } finally {
    await page.viewport(...original)
  }
})

test('mobile text opens a full learning view without a Breakdown button', async () => {
  if (window.innerWidth >= 1100) return
  await render(<Fixture prepared />)
  expect(page.getByTestId('breakdown-button').query()).toBeNull()
  const copy = mainCopy().element()
  await page.getByTestId('main-translation').click()
  await expect.element(page.getByTestId('learning-panel')).toBeVisible()
  const panel = page
    .getByTestId('learning-panel')
    .element()
    .getBoundingClientRect()
  expect(panel.height).toBeGreaterThan(window.innerHeight * 0.75)
  expect(mainCopy().element()).toBe(copy)
  visibleRect(copy)
  await settledShot('full-learning')
  await page
    .getByRole('button', { name: 'Close learning', exact: true })
    .click()
  expect(page.getByTestId('learning-panel').query()).toBeNull()
  await expect.element(page.getByTestId('main-translation')).toBeVisible()
})

test('mobile Adjust floats without resizing the header or moving Copy in portrait and split views', async () => {
  if (window.innerWidth >= 1100) return
  const original = [window.innerWidth, window.innerHeight] as const
  try {
    await render(<Fixture prepared />)
    for (const [width, height] of [
      [382, 580],
      [580, 382],
      [736, 594],
      [960, 548],
    ]) {
      await page.viewport(width!, height!)
      await expect
        .poll(() =>
          document.querySelector('.app-shell')?.getAttribute('data-layout'),
        )
        .toBe(width! >= 560 ? 'split' : 'stack')
      await expect.element(page.getByTestId('adjust-button')).toBeVisible()
      const header = document.querySelector('.app-header')!
      const before = header.getBoundingClientRect()
      const target = document
        .querySelector('.target-toolbar')!
        .getBoundingClientRect()
      const copy = mainCopy().element()
      const copyBefore = copy.getBoundingClientRect()
      await page.getByTestId('adjust-button').click()
      await expect.element(page.getByTestId('refine-chip-softer')).toBeVisible()
      await expect
        .poll(() =>
          Math.abs(header.getBoundingClientRect().height - before.height),
        )
        .toBeLessThanOrEqual(1)
      expect(
        Math.abs(
          document.querySelector('.target-toolbar')!.getBoundingClientRect()
            .top - target.top,
        ),
      ).toBeLessThanOrEqual(1)
      const copyAfter = copy.getBoundingClientRect()
      expect(Math.abs(copyAfter.top - copyBefore.top)).toBeLessThanOrEqual(1)
      expect(
        document
          .elementFromPoint(
            copyAfter.left + copyAfter.width / 2,
            copyAfter.top + copyAfter.height / 2,
          )
          ?.closest('button'),
      ).toBe(copy)
      const panel = document
        .querySelector('.adjust-content[data-open]')!
        .getBoundingClientRect()
      expect(panel.left).toBeGreaterThanOrEqual(0)
      expect(panel.right).toBeLessThanOrEqual(width!)
      expect(panel.bottom).toBeLessThanOrEqual(height!)
      await settledShot(`mobile-adjust-overlay-${width}`)
      await userEvent.keyboard('{Escape}')
      await expect
        .element(page.getByTestId('adjust-button'))
        .toHaveAttribute('aria-expanded', 'false')
    }
  } finally {
    await page.viewport(...original)
  }
})

test('source grammar is visible before selecting a phrase and never changes editing', async () => {
  await render(<Fixture reading prepared />)
  const input = page.getByTestId('input-textarea')
  const node = input.element() as HTMLTextAreaElement
  await expect
    .poll(
      () => document.querySelectorAll('[data-testid="source-grammar"]').length,
    )
    .toBe(2)
  const mirror = page.getByTestId('source-highlight').element()
  expect(mirror.textContent.replace(/\u200b/g, '')).toBe(translation)
  expect(
    [...mirror.querySelectorAll('[data-testid="source-grammar"]')].map(
      (n) => n.textContent,
    ),
  ).toEqual(['줘서', '고마워요'])
  expect(getComputedStyle(mirror).pointerEvents).toBe('none')
  expect(
    getComputedStyle(mirror.querySelector('[data-testid="source-grammar"]')!)
      .textDecorationLine,
  ).toBe('underline')
  await settledShot('source-grammar-before-selection')
  node.focus()
  node.setSelectionRange(3, 7)
  expect(input.element()).toBe(node)
  expect([node.selectionStart, node.selectionEnd]).toEqual([3, 7])
  await input.fill(translation + ' 수정')
  expect(document.querySelector('[data-testid="source-highlight"]')).toBeNull()
})

test('Breakdown action never appears before phrase details arrive or after completion', async () => {
  await render(<Fixture prepared={false} />)
  const current = useTranslatorContext().live!
  update({ live: { ...current, done: false }, streaming: true })
  await expect.element(page.getByTestId('main-translation')).toBeVisible()
  expect(page.getByTestId('breakdown-button').query()).toBeNull()
  update({ live: current, streaming: false })
  expect(page.getByTestId('breakdown-button').query()).toBeNull()
})

test('overlapping model quotes keep the remaining Korean source breakdown usable', async () => {
  await render(<Fixture reading prepared />)
  const text =
    '평면도 작성 기능을 확인해 보실 수 있는 링크를 공유드립니다.\n직접 사용해 보시고, UX 흐름이나 사용성에 관한 의견이 있으시면 편하게 알려 주세요.'
  const current = useTranslatorContext().live!
  if (current.intent !== 'sentence')
    throw new Error('Expected sentence fixture')
  const phrases = [
    '평면도 작성 기능을',
    '작성 기능을 확인해 보실 수 있는',
    '링크를 공유드립니다',
    '직접 사용해 보시고',
  ].map((phraseText, i) => ({
    ...fact,
    gloss: 'A source phrase.',
    text: phraseText,
    sourceTexts: [],
    usageNote: '',
    characters: [],
    grammarHighlights: i === 2 ? ['드립니다'] : i === 3 ? ['보시고'] : [],
  }))
  update({
    input: text,
    live: {
      ...current,
      text,
      requestKey: translationRequestKey({
        text,
        source: 'ko',
        target: 'en',
        mode: 'casual',
        context: '',
        refinements: [],
        uiLang: 'en',
      }),
      partial: { ...current.partial, learningPhrases: phrases },
    },
  })
  await expect
    .poll(
      () => document.querySelectorAll('[data-testid="source-grammar"]').length,
    )
    .toBe(2)
  await openOverview()
  await expect.element(page.getByTestId('learning-chunk').first()).toBeVisible()
  expect(page.getByTestId('learning-chunk').elements()).toHaveLength(2)
  expect(
    page.getByTestId('learning-chunk').first().element().textContent,
  ).toContain('링크를 공유드립니다')
  await page.getByTestId('learning-chunk').first().click()
  await expect
    .element(page.getByText(fact.grammar, { exact: true }))
    .toBeVisible()
  expect(mainCopy().element().hasAttribute('disabled')).toBe(false)
})

function sourceGrammarPosition(input: HTMLTextAreaElement) {
  const grammar = document.querySelector('[data-testid="source-grammar"]')!
  const rect = grammar.getClientRects()[0]!
  const field = input.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2 - field.left,
    y: rect.top + rect.height / 2 - field.top,
  }
}

test('tapping source grammar opens its phrase and preserves the editor caret', async () => {
  await render(<Fixture reading prepared />)
  const input = page.getByTestId('input-textarea')
  const node = input.element() as HTMLTextAreaElement
  await input.click({ position: sourceGrammarPosition(node) })
  const caret = [node.selectionStart, node.selectionEnd]
  await expect
    .element(page.getByRole('region', { name: '도와줘서', exact: true }))
    .toBeVisible()
  expect(input.element()).toBe(node)
  expect(node.value).toBe(translation)
  expect([node.selectionStart, node.selectionEnd]).toEqual(caret)
  if (page.getByTestId('learning-panel').query()) {
    await page
      .getByRole('button', { name: 'Close learning', exact: true })
      .click()
  }
  expect(document.activeElement).toBe(node)
  expect([node.selectionStart, node.selectionEnd]).toEqual(caret)
  await input.fill(translation + ' 수정')
  expect(document.querySelector('.phrase-detail')).toBeNull()
})

test.each([
  'double click',
  'long press',
  'selection',
  'typing',
  'outside click',
  'arrow key',
  'plain source',
  'stale result',
] as const)('source grammar keeps ordinary editing for %s', async (gesture) => {
  await render(<Fixture reading prepared />)
  const input = page.getByTestId('input-textarea')
  const node = input.element() as HTMLTextAreaElement
  const position = sourceGrammarPosition(node)
  if (gesture === 'plain source')
    position.x = parseFloat(getComputedStyle(node).paddingLeft) + 4
  if (gesture === 'double click') await userEvent.dblClick(input, { position })
  else if (gesture === 'long press') await input.click({ position, delay: 600 })
  else {
    await input.click({ position })
    if (gesture === 'selection') node.setSelectionRange(3, 7)
    if (gesture === 'typing') await userEvent.keyboard('x')
    if (gesture === 'arrow key') await userEvent.keyboard('{ArrowLeft}')
    if (gesture === 'stale result')
      update({ error: { kind: 'server', message: 'Unavailable' } })
    if (gesture === 'outside click')
      await page.getByTestId('context-toggle').click()
  }
  await new Promise((r) => setTimeout(r, 450))
  expect(document.querySelector('.phrase-detail')).toBeNull()
  expect(page.getByTestId('learning-panel').query()).toBeNull()
  expect(input.element()).toBe(node)
  if (gesture === 'selection')
    expect([node.selectionStart, node.selectionEnd]).toEqual([3, 7])
  if (gesture === 'typing') expect(node.value).toContain('x')
  if (gesture === 'double click')
    expect(node.selectionEnd).toBeGreaterThan(node.selectionStart)
})

test.each([false, true])(
  'scrolled source grammar stays accurate and scrolling cancels a pending tap (%s)',
  async (cancelTap) => {
    await render(<Fixture reading prepared />)
    const current = useTranslatorContext().live!
    if (current.intent !== 'sentence')
      throw new Error('Expected sentence fixture')
    const text =
      Array(15).fill('다른 문장입니다.').join('\n') + '\n' + translation
    update({
      input: text,
      live: {
        ...current,
        text,
        requestKey: translationRequestKey({
          text,
          source: 'ko',
          target: 'en',
          mode: 'casual',
          context: '',
          refinements: [],
          uiLang: 'en',
        }),
      },
    })
    const input = page.getByTestId('input-textarea')
    const node = input.element() as HTMLTextAreaElement
    await expect.element(input).toHaveValue(text)
    node.focus()
    node.setSelectionRange(text.length, text.length)
    node.scrollTop = node.scrollHeight
    await expect
      .poll(() => page.getByTestId('source-highlight').element().scrollTop)
      .toBe(node.scrollTop)
    await input.click({ position: sourceGrammarPosition(node) })
    const caret = [node.selectionStart, node.selectionEnd]
    const scroll = node.scrollTop
    if (cancelTap) {
      node.scrollTop = 0
      await new Promise((r) => setTimeout(r, 450))
      expect(document.querySelector('.phrase-detail')).toBeNull()
      expect(page.getByTestId('learning-panel').query()).toBeNull()
    } else {
      await expect
        .element(page.getByRole('region', { name: '도와줘서', exact: true }))
        .toBeVisible()
      if (page.getByTestId('learning-panel').query())
        await page
          .getByRole('button', { name: 'Close learning', exact: true })
          .click()
      expect(input.element()).toBe(node)
      expect(document.activeElement).toBe(node)
      expect([node.selectionStart, node.selectionEnd]).toEqual(caret)
      expect(node.scrollTop).toBe(scroll)
    }
  },
)

test('source grammar tap survives the keyboard opening on focus', async () => {
  if (window.innerWidth >= 1100) return
  const viewport = Object.assign(new EventTarget(), {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetTop: 0,
    scale: 1,
  })
  vi.stubGlobal('visualViewport', viewport)
  try {
    await render(<Fixture reading prepared />)
    const input = page.getByTestId('input-textarea')
    const node = input.element() as HTMLTextAreaElement
    node.addEventListener(
      'focus',
      () => {
        viewport.height = Math.floor(window.innerHeight * 0.5)
        viewport.dispatchEvent(new Event('resize'))
      },
      { once: true },
    )
    await input.click({ position: sourceGrammarPosition(node) })
    const caret = [node.selectionStart, node.selectionEnd]
    await expect
      .element(page.getByRole('region', { name: '도와줘서', exact: true }))
      .toBeVisible()
    await page
      .getByRole('button', { name: 'Close learning', exact: true })
      .click()
    expect(document.activeElement).toBe(node)
    expect([node.selectionStart, node.selectionEnd]).toEqual(caret)
  } finally {
    vi.unstubAllGlobals()
  }
})

test('dragging from a source grammar underline selects native editor text', async () => {
  await render(<Fixture reading prepared />)
  const input = page.getByTestId('input-textarea')
  const node = input.element() as HTMLTextAreaElement
  const start = sourceGrammarPosition(node)
  await userEvent.dragAndDrop(input, input, {
    sourcePosition: start,
    targetPosition: { x: start.x + 50, y: start.y },
  })
  await new Promise((r) => setTimeout(r, 450))
  expect(node.selectionEnd).toBeGreaterThan(node.selectionStart)
  expect(document.querySelector('.phrase-detail')).toBeNull()
  expect(input.element()).toBe(node)
})
