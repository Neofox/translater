import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEBOUNCE_MS as full,
  FINISHED_DEBOUNCE_MS as fast,
  debounceFor,
  detectIntent,
  detectLanguage,
  resolveTarget,
} from './composer.js'

// Cases from src/hooks/useTranslate.test.tsx.
test('debounceFor shortens only for sentence-final punctuation or emoji', () => {
  assert.equal(debounceFor('내일 봐요?', full), fast)
  assert.equal(debounceFor('He said "fine."', full), fast)
  assert.equal(debounceFor('고마워~', full), fast)
  assert.equal(debounceFor('明日ね。', full), fast)
  assert.equal(debounceFor('see you 👍🏽', full), fast)
  assert.equal(debounceFor('see you', full), full)
  assert.equal(debounceFor('내일 ㅂ', full), full)
  assert.equal(debounceFor('Done.\n', full), full)
  assert.equal(debounceFor('Done.', 0), 0)
})

test('detectIntent', () => {
  assert.equal(detectIntent(''), 'sentence')
  assert.equal(detectIntent('   '), 'sentence')
  assert.equal(detectIntent('thanks'), 'word')
  assert.equal(detectIntent('thank you'), 'word')
  assert.equal(detectIntent('  get up  '), 'word')
  assert.equal(detectIntent('고마워'), 'word')
  assert.equal(detectIntent('open the browser'), 'sentence')
  assert.equal(detectIntent('thanks.'), 'sentence')
  assert.equal(detectIntent('뭐?'), 'sentence')
  assert.equal(detectIntent('supercalifragilistic expialidocious'), 'sentence')
  assert.equal(detectIntent('thanks [fx:word]abcde'), 'word')
})

// Cases from src/lib/detectLanguage.test.ts. Dropped (tinyld not shipped,
// see README.md): "distinguishes French from English" and "distinguishes
// Spanish from English"; Latin text is 'en' until the model reports.
test('detectLanguage', () => {
  assert.equal(detectLanguage('안녕하세요, 오늘 뭐 해요?'), 'ko')
  assert.equal(detectLanguage('図書館に行く'), 'ja')
  assert.equal(detectLanguage('我今天要去图书馆看书'), 'zh')
  assert.equal(detectLanguage('How are you doing today?'), 'en')
  assert.equal(detectLanguage('ok'), 'en')
  assert.equal(detectLanguage('회의 meeting 일정 조율 부탁드려요'), 'ko')
  assert.equal(detectLanguage('   '), null)
  assert.equal(detectLanguage('1234 !?'), null)
  assert.equal(detectLanguage('Ich möchte heute in die Bibliothek gehen.'), 'en')
})

// Cases from src/lib/resolveTranslationTarget.test.ts.
test('resolveTarget', () => {
  const text = '[신한카드]온라인명세서로 1년간 면제된 SMS이용료200원 서비스가 종료됩니다(기간만료:05월)'
  const detected = detectLanguage(text)
  assert.equal(detected, 'ko')
  assert.equal(resolveTarget({ source: 'auto', target: 'ko', detected }), 'en')
  assert.equal(resolveTarget({ source: 'ko', target: 'ko', detected: null }), 'ko')
  assert.equal(resolveTarget({ source: 'auto', target: 'en', detected: 'en' }), 'ko')
  assert.equal(resolveTarget({ source: 'auto', target: 'ko', detected: null }), 'ko')
})
