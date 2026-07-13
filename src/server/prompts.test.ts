import { describe, expect, it } from 'vitest'
import { sentencePrompt, wordPrompt } from './prompts'
import { SentenceResult, WordResult } from './schemas'

const MODES = ['friends', 'casual', 'professional'] as const
const UI_LANGS = ['en', 'ko'] as const

type PromptMessages =
  ReturnType<typeof sentencePrompt> | ReturnType<typeof wordPrompt>

function textOf(content: PromptMessages[number]['content']): string {
  return typeof content === 'string'
    ? content
    : content.map((block) => block.text).join('')
}

function assistantOf(msgs: PromptMessages): unknown {
  const m = msgs.find((x) => x.role === 'assistant')
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
    expect(textOf(full[0]!.content)).toBe(textOf(bare[0]!.content))
  })

  it('word system prompt is byte-identical with and without context', () => {
    const bare = wordPrompt(base)
    const full = wordPrompt({ ...base, context: '배 타고 왔어요' })
    expect(textOf(full[0]!.content)).toBe(textOf(bare[0]!.content))
  })

  it('marks the stable prefix before live user input with an explicit cache breakpoint', () => {
    for (const msgs of [sentencePrompt(base), wordPrompt(base)]) {
      const user = msgs.at(-1)
      expect(user?.content).not.toBeTypeOf('string')
      if (typeof user?.content === 'string') continue
      expect(user?.content[0]?.prompt_cache_breakpoint).toEqual({
        mode: 'explicit',
      })
      expect(user?.content[1]?.prompt_cache_breakpoint).toBeUndefined()
      expect(user?.content[1]?.text).toContain('<source>')
    }
  })

  it('sentence user message carries <context> and <adjustments> before <source>', () => {
    const msgs = sentencePrompt({
      ...base,
      context: 'ctx here',
      refinements: ['make it softer', 'make it shorter'],
      previousMain: '내일 봐요',
    })
    const user = textOf(msgs[msgs.length - 1]!.content)
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
    const user = textOf(sentencePrompt(base).at(-1)!.content)
    expect(user).not.toContain('<context>')
    expect(user).not.toContain('<adjustments>')
  })

  it('word user message carries <context> when set, omits it when empty', () => {
    const withCtx = textOf(
      wordPrompt({
        ...base,
        text: '배',
        context: '배 타고 왔어',
      }).at(-1)!.content,
    )
    expect(withCtx).toContain('<context>\n배 타고 왔어\n</context>')
    expect(withCtx.indexOf('<context>')).toBeLessThan(
      withCtx.indexOf('<source>'),
    )
    const bare = textOf(wordPrompt({ ...base, text: '배' }).at(-1)!.content)
    expect(bare).not.toContain('<context>')
  })

  it('whitespace-only context is treated as absent', () => {
    const user = textOf(
      sentencePrompt({ ...base, context: '   ' }).at(-1)!.content,
    )
    expect(user).not.toContain('<context>')
  })
})
