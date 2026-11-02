import type { ModelMessage, SystemModelMessage, UserModelMessage } from 'ai'
import Mustache from 'mustache'
import sentencePolishEn from '../../shared/translation/fewshots/sentence-polish-en.json'
import sentencePolishKo from '../../shared/translation/fewshots/sentence-polish-ko.json'
import sentenceReadingEn from '../../shared/translation/fewshots/sentence-reading-en.json'
import sentenceReadingKo from '../../shared/translation/fewshots/sentence-reading-ko.json'
import sentenceTranslateEn from '../../shared/translation/fewshots/sentence-translate-en.json'
import sentenceTranslateKo from '../../shared/translation/fewshots/sentence-translate-ko.json'
import wordCasualEn from '../../shared/translation/fewshots/word-casual-en.json'
import wordCasualKo from '../../shared/translation/fewshots/word-casual-ko.json'
import wordFriendsEn from '../../shared/translation/fewshots/word-friends-en.json'
import wordFriendsKo from '../../shared/translation/fewshots/word-friends-ko.json'
import wordPolishEn from '../../shared/translation/fewshots/word-polish-en.json'
import wordPolishKo from '../../shared/translation/fewshots/word-polish-ko.json'
import wordProfessionalEn from '../../shared/translation/fewshots/word-professional-en.json'
import wordProfessionalKo from '../../shared/translation/fewshots/word-professional-ko.json'
import { promptNameFor } from '../lib/languages'
import type { Mode } from '../lib/types'
import type { UiLang } from '../lib/i18n'
import PROMPT_TEMPLATES from './promptTemplates.generated.json'

// All model-facing wording lives in shared/translation/ (templates, few-shots,
// schemas) and is shared with the Go app; shared/translation/README.md defines
// every template variable. This module only computes those variables, renders
// the templates and assembles the messages. The golden request bodies in
// shared/translation/fixtures/ prove the result is byte-identical.

export type TranslationPrompt = {
  instructions: SystemModelMessage[]
  messages: ModelMessage[]
}

type Fewshot = { user: string; assistant: object }

const FEWSHOTS: Record<string, Fewshot> = {
  'sentence-translate-en': sentenceTranslateEn,
  'sentence-translate-ko': sentenceTranslateKo,
  'sentence-reading-en': sentenceReadingEn,
  'sentence-reading-ko': sentenceReadingKo,
  'sentence-polish-en': sentencePolishEn,
  'sentence-polish-ko': sentencePolishKo,
  'word-friends-en': wordFriendsEn,
  'word-casual-en': wordCasualEn,
  'word-professional-en': wordProfessionalEn,
  'word-friends-ko': wordFriendsKo,
  'word-casual-ko': wordCasualKo,
  'word-professional-ko': wordProfessionalKo,
  'word-polish-en': wordPolishEn,
  'word-polish-ko': wordPolishKo,
}

/** Template variables; see shared/translation/README.md for definitions. */
export type PromptView = Record<string, string | boolean>

const TEMPLATES: Record<string, string> = PROMPT_TEMPLATES

/**
 * Renders a shared template by name (path below prompts/ without extension).
 * HTML escaping is disabled; every template can be used as a partial; the
 * single final newline of the template file is not part of the text.
 */
export function renderPrompt(name: string, view: PromptView): string {
  const template = TEMPLATES[name]
  if (template === undefined) throw new Error(`unknown prompt template ${name}`)
  return Mustache.render(template, view, TEMPLATES, {
    escape: (value: string) => value,
  }).replace(/\n$/, '')
}

type ViewInput = {
  source: string
  target: string
  mode: Mode
  uiLang: UiLang
  intent: 'sentence' | 'word'
}

function metadataLangName(uiLang: UiLang) {
  return uiLang === 'ko' ? 'KOREAN' : 'ENGLISH'
}

/** Every flag and derived string the templates use (README: Variables). */
export function promptView({
  source,
  target,
  mode,
  uiLang,
  intent,
}: ViewInput): PromptView {
  const kr = source === 'ko' || target === 'ko'
  const isPolish = source === target
  const pairInvolvesForeign =
    source !== 'en' && source !== 'auto' ? true : target !== 'en'
  const view: PromptView = {
    source,
    target,
    uiLang,
    sourceName: promptNameFor(source),
    targetName: promptNameFor(target),
    uiLangName: promptNameFor(uiLang),
    metaLang: metadataLangName(uiLang),
    uiKo: uiLang === 'ko',
    isPolish,
    kr,
    autoSource: source === 'auto',
    intentSentence: intent === 'sentence',
    modeFriends: mode === 'friends',
    modeCasual: mode === 'casual',
    modeProfessional: mode === 'professional',
    modeUpper: mode.toUpperCase(),
    populateFormalityNote: kr && target === 'ko' && mode !== 'friends',
    detailReminder: pairInvolvesForeign && !isPolish,
    manyAlternatives: kr || target === 'ja',
  }
  // Derived strings: rendered from their own templates with the same view.
  view.toneGuidance = renderPrompt('tone', view)
  view.koreanRegisterGuidance = renderPrompt('korean-register', view)
  view.wordBand = renderPrompt('word-band', view)
  return view
}

// Stable instructions and few-shot messages stay before live content so
// Provider prefix caching can reuse the longest possible prefix.
function finalUserContent(
  instruction: string,
  liveInput: string,
): UserModelMessage['content'] {
  return [
    {
      type: 'text',
      text: instruction,
      providerOptions: {
        openai: {
          promptCacheBreakpoint: { mode: 'explicit' },
        },
      },
    },
    { type: 'text', text: liveInput },
  ]
}

function translationPrompt(
  uiLang: UiLang,
  system: string,
  fewshotName: string,
  finalUser: UserModelMessage['content'],
): TranslationPrompt {
  const fewshot = FEWSHOTS[fewshotName]!
  return {
    instructions: [
      {
        role: 'system',
        content: renderPrompt('language-rule', { uiKo: uiLang === 'ko' }),
      },
      { role: 'system', content: system },
    ],
    messages: [
      { role: 'user', content: fewshot.user },
      // Compact JSON in the file's key order (README: Few-shots).
      { role: 'assistant', content: JSON.stringify(fewshot.assistant) },
      { role: 'user', content: finalUser },
    ],
  }
}

// Pasted text must not forge the live-block delimiters: a stray `</source>`
// made the model translate only the text after a fake `<source>`. Swap the
// angle brackets of those tags for look-alike quotes so the text stays
// readable and translatable but can never open or close a block.
const BLOCK_TAG = /<(\s*\/?\s*(?:source|context|adjustments)\b[^<>]*)>/gi

function liveText(text: string) {
  return text.replace(BLOCK_TAG, '‹$1›')
}

// Builds the optional prefix blocks for the final user message.
function userBlocks(args: {
  context?: string
  refinements?: string[]
  previousMain?: string
}) {
  const ctx = args.context?.trim()
  const contextBlock = ctx ? `<context>\n${liveText(ctx)}\n</context>\n\n` : ''
  const adjustmentsBlock =
    args.refinements && args.refinements.length > 0
      ? `<adjustments>\nprevious: ${liveText(args.previousMain ?? '')}\n${args.refinements
          .map((r) => `- ${liveText(r)}`)
          .join('\n')}\n</adjustments>\n\n`
      : ''
  return contextBlock + adjustmentsBlock
}

function sourceBlock(text: string) {
  return `<source>\n${liveText(text)}\n</source>`
}

export function koreanRegisterGuidance(mode: Mode) {
  return renderPrompt('korean-register', modeFlags(mode))
}

export function toneGuidance(mode: Mode) {
  return renderPrompt('tone', modeFlags(mode))
}

function modeFlags(mode: Mode): PromptView {
  return {
    modeFriends: mode === 'friends',
    modeCasual: mode === 'casual',
    modeProfessional: mode === 'professional',
  }
}

export type SentencePromptArgs = {
  text: string
  source: string
  target: string
  mode: Mode
  uiLang: UiLang
  context?: string
  refinements?: string[]
  previousMain?: string
}

export type SentenceSystemContext = {
  source: string
  target: string
  mode: Mode
  uiLang: UiLang
  isPolish: boolean
  kr: boolean
  metaLang: string
}

/** Template view for a sentence system message built from its context. */
export function sentenceSystemView(ctx: SentenceSystemContext): PromptView {
  return {
    ...promptView({ ...ctx, intent: 'sentence' }),
    isPolish: ctx.isPolish,
    kr: ctx.kr,
    metaLang: ctx.metaLang,
  }
}

export function sentenceSystem(ctx: SentenceSystemContext): string {
  return renderPrompt('sentence-system', sentenceSystemView(ctx))
}

// `buildSystem` lets quality evals try alternative instructions against the
// same few-shots, live blocks and schema; production always uses the default.
export function sentencePrompt(
  args: SentencePromptArgs,
  buildSystem: (ctx: SentenceSystemContext) => string = sentenceSystem,
): TranslationPrompt {
  const {
    text,
    source,
    target,
    mode,
    uiLang,
    context,
    refinements,
    previousMain,
  } = args
  const view = promptView({ source, target, mode, uiLang, intent: 'sentence' })
  const isPolish = source === target
  const system = buildSystem({
    source,
    target,
    mode,
    uiLang,
    isPolish,
    kr: source === 'ko' || target === 'ko',
    metaLang: metadataLangName(uiLang),
  })
  const isReading = target === uiLang && source !== uiLang
  const fewshot = `sentence-${isPolish ? 'polish' : isReading ? 'reading' : 'translate'}-${uiLang === 'ko' ? 'ko' : 'en'}`

  return translationPrompt(
    uiLang,
    system,
    fewshot,
    finalUserContent(
      renderPrompt('sentence-reminder', view),
      `${userBlocks({ context, refinements, previousMain })}${sourceBlock(text)}`,
    ),
  )
}

export function wordPrompt(args: {
  text: string
  source: string
  target: string
  mode: Mode
  uiLang: UiLang
  context?: string
}): TranslationPrompt {
  const { text, source, target, mode, uiLang, context } = args
  const view = promptView({ source, target, mode, uiLang, intent: 'word' })
  const fewshot = `word-${source === target ? 'polish' : mode}-${uiLang === 'ko' ? 'ko' : 'en'}`

  return translationPrompt(
    uiLang,
    renderPrompt('word-system', view),
    fewshot,
    finalUserContent(
      renderPrompt('word-reminder', view),
      `${userBlocks({ context })}${sourceBlock(text)}`,
    ),
  )
}
