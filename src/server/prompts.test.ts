import { describe, expect, it } from 'vitest'
import { sentencePrompt, wordPrompt } from './prompts'
import { SentenceResult, WordResult } from './schemas'

const MODES = ['friends', 'casual', 'professional'] as const
const UI_LANGS = ['en', 'ko'] as const

function assistantOf(msgs: Array<{ role: string; content: string }>): unknown {
  const m = msgs.find((x) => x.role === 'assistant')
  if (!m) throw new Error('no assistant few-shot in prompt')
  return JSON.parse(m.content)
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
