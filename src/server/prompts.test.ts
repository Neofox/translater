import { describe, expect, it } from 'vitest'
import { sentencePrompt, wordPrompt } from './prompts'
import { SentenceResult, WordResult } from './schemas'

const MODES = ['friends', 'casual', 'professional'] as const
const UI_LANGS = ['en', 'ko'] as const

type PromptBundle =
  ReturnType<typeof sentencePrompt> | ReturnType<typeof wordPrompt>

function textOf(content: PromptBundle['messages'][number]['content']): string {
  if (typeof content !== 'string') {
    throw new Error('translation prompts must use text-only model messages')
  }
  return content
}

function textPartsOf(
  content: PromptBundle['messages'][number]['content'],
): Array<{
  type: 'text'
  text: string
  providerOptions?: Record<string, Record<string, unknown>>
}> {
  if (!Array.isArray(content)) {
    throw new Error('final translation message must use separate text parts')
  }
  return content as Array<{
    type: 'text'
    text: string
    providerOptions?: Record<string, Record<string, unknown>>
  }>
}

function finalUserParts(prompt: PromptBundle) {
  return textPartsOf(prompt.messages.at(-1)!.content)
}

function liveTextOf(prompt: PromptBundle): string {
  return finalUserParts(prompt).at(-1)!.text
}

function assistantOf(prompt: PromptBundle): unknown {
  const m = prompt.messages.find((message) => message.role === 'assistant')
  if (!m) throw new Error('no assistant few-shot in prompt')
  return JSON.parse(textOf(m.content))
}

describe('few-shot payloads satisfy the strict schemas', () => {
  for (const uiLang of UI_LANGS) {
    for (const mode of MODES) {
      it(`sentence translate uiLang=${uiLang} mode=${mode}`, () => {
        const msgs = sentencePrompt({
          text: 'hi',
          source: 'auto',
          target: 'ko',
          mode,
          uiLang,
        })
        expect(() => SentenceResult.parse(assistantOf(msgs))).not.toThrow()
      })
      it(`sentence polish uiLang=${uiLang} mode=${mode}`, () => {
        const msgs = sentencePrompt({
          text: 'hi',
          source: 'en',
          target: 'en',
          mode,
          uiLang,
        })
        expect(() => SentenceResult.parse(assistantOf(msgs))).not.toThrow()
      })
      it(`word translate uiLang=${uiLang} mode=${mode}`, () => {
        const msgs = wordPrompt({
          text: 'hi',
          source: 'en',
          target: 'ko',
          mode,
          uiLang,
        })
        expect(() => WordResult.parse(assistantOf(msgs))).not.toThrow()
      })
      it(`word polish uiLang=${uiLang} mode=${mode}`, () => {
        const msgs = wordPrompt({
          text: 'hi',
          source: 'en',
          target: 'en',
          mode,
          uiLang,
        })
        expect(() => WordResult.parse(assistantOf(msgs))).not.toThrow()
      })
    }
  }
})

describe('context/adjustments blocks (prefix-cache invariant)', () => {
  const base = {
    text: 'see you tomorrow',
    source: 'en',
    target: 'ko',
    mode: 'casual' as const,
    uiLang: 'en' as const,
  }

  it('sentence system prompt is byte-identical with and without context/refinements', () => {
    const bare = sentencePrompt(base)
    const full = sentencePrompt({
      ...base,
      context: '내일 회의 몇 시에 해요?',
      refinements: ['make it softer'],
      previousMain: '내일 봐요',
    })
    expect(full.instructions).toEqual(bare.instructions)
  })

  it('word system prompt is byte-identical with and without context', () => {
    const bare = wordPrompt(base)
    const full = wordPrompt({ ...base, context: '배 타고 왔어요' })
    expect(full.instructions).toEqual(bare.instructions)
  })

  it('keeps stable instructions before all live content', () => {
    for (const prompt of [sentencePrompt(base), wordPrompt(base)]) {
      expect(prompt.instructions.map((message) => message.role)).toEqual([
        'system',
        'system',
      ])
      expect(prompt.messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
      ])
      const parts = finalUserParts(prompt)
      expect(parts).toHaveLength(2)
      const stable = parts[0]!
      const live = parts[1]!
      expect(stable.text).toContain('(Reminder:')
      expect(stable.text).not.toContain('<source>')
      expect(stable.providerOptions).toEqual({
        openai: {
          promptCacheBreakpoint: { mode: 'explicit' },
        },
      })
      expect(live.text).toContain('<source>')
      expect(live.providerOptions).toBeUndefined()
    }
  })

  it('puts the metadata-language rule first in v7 instructions', () => {
    const english = sentencePrompt(base)
    const korean = sentencePrompt({ ...base, uiLang: 'ko' })
    expect(english.instructions[0]?.role).toBe('system')
    expect(korean.instructions[0]?.role).toBe('system')
    expect(english.instructions[0]!.content).not.toBe(
      korean.instructions[0]!.content,
    )
  })

  it('keeps instructions and every pre-live message byte-identical', () => {
    const bare = sentencePrompt(base)
    const live = sentencePrompt({
      ...base,
      text: 'different text',
      context: 'private context',
      refinements: ['make it softer'],
      previousMain: 'previous result',
    })
    expect(live.instructions).toEqual(bare.instructions)
    expect(live.messages.slice(0, -1)).toEqual(bare.messages.slice(0, -1))
  })

  it('sentence user message carries <context> and <adjustments> before <source>', () => {
    const msgs = sentencePrompt({
      ...base,
      context: 'ctx here',
      refinements: ['make it softer', 'make it shorter'],
      previousMain: '내일 봐요',
    })
    const user = liveTextOf(msgs)
    expect(user).toContain('<context>\nctx here\n</context>')
    expect(user).toContain(
      '<adjustments>\nprevious: 내일 봐요\n- make it softer\n- make it shorter\n</adjustments>',
    )
    expect(user.indexOf('<context>')).toBeLessThan(
      user.indexOf('<adjustments>'),
    )
    expect(user.indexOf('<adjustments>')).toBeLessThan(user.indexOf('<source>'))
  })

  it('bare sentence requests omit both blocks', () => {
    const user = liveTextOf(sentencePrompt(base))
    expect(user).not.toContain('<context>')
    expect(user).not.toContain('<adjustments>')
  })

  it('word user message carries <context> when set, omits it when empty', () => {
    const withCtx = liveTextOf(
      wordPrompt({ ...base, text: '배', context: '배 타고 왔어' }),
    )
    expect(withCtx).toContain('<context>\n배 타고 왔어\n</context>')
    expect(withCtx.indexOf('<context>')).toBeLessThan(
      withCtx.indexOf('<source>'),
    )
    const bare = liveTextOf(wordPrompt({ ...base, text: '배' }))
    expect(bare).not.toContain('<context>')
  })

  it('whitespace-only context is treated as absent', () => {
    const user = liveTextOf(sentencePrompt({ ...base, context: '   ' }))
    expect(user).not.toContain('<context>')
  })
})

describe('punctuation preference', () => {
  for (const uiLang of UI_LANGS) {
    it.each([sentencePrompt, wordPrompt])(
      'avoids adding em dashes in generated prose for ' + uiLang,
      (build) => {
        const prompt = build({
          text: 'thank you',
          source: 'en',
          target: 'ko',
          mode: 'casual',
          uiLang,
        })
        expect(
          prompt.instructions
            .map((message) => message.content)
            .join('\n')
            .match(/Avoid em dashes in generated prose/g),
        ).toHaveLength(1)
      },
    )
  }
})

it('keeps the model schema usage example consistent with the punctuation preference', () => {
  expect(WordResult.shape.primaryUsageNote.description).not.toContain('—')
})
