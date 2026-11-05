import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEBOUNCE_MS as full,
  FINISHED_DEBOUNCE_MS as fast,
  debounceFor,
  detectIntent,
  detectLanguage,
  resolveTarget,
  routingDetected,
  typedBeforeInit,
} from './composer.js'
import { requestKey } from './copy.js'

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

// Review fix: French under Auto -> English routes as 'en' (Korean target);
// the model then reports 'fr'. The result's key must still match the
// unchanged input, or Copy/Listen would stay disabled for good.
test('the model report does not re-route the current result', () => {
  const text = "Bonjour, comment ça va aujourd'hui ?"
  const prefs = { source: 'auto', target: 'en', mode: 'casual', context: '', refinements: [], uiLang: 'en' }
  const keyFor = (live, model) => {
    const detected = routingDetected({ source: prefs.source, text, live, model })
    return requestKey({ ...prefs, text, target: resolveTarget({ ...prefs, detected }) })
  }
  const runDetected = routingDetected({ source: 'auto', text, live: null, model: null })
  assert.equal(runDetected, 'en')
  const live = { source: 'auto', text: text.trim(), detected: runDetected, key: keyFor(null, null) }
  assert.match(live.key, /"ko"/)
  const model = { text: text.trim(), lang: 'fr' }
  assert.equal(keyFor(live, model), live.key, 'Copy stays enabled after nt-source-lang')
  // Without the pin the key would change (the dead result).
  assert.notEqual(keyFor(null, model), live.key)
  // After an edit the pin no longer applies; the model report applies to
  // exactly the text it was made for.
  assert.equal(routingDetected({ source: 'auto', text: `${text} !`, live, model }), 'en')
  assert.equal(routingDetected({ source: 'ko', text, live, model }), null)
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

// Text in the field when the modules run: typed on a slow first load (run
// it) versus restored by reload/back-forward form restoration (never a paid
// run).
test('typedBeforeInit runs only text typed on a fresh navigation', () => {
  assert.equal(typedBeforeInit('hello', '', 'navigate'), true)
  assert.equal(typedBeforeInit('hello', '', 'reload'), false)
  assert.equal(typedBeforeInit('hello', '', 'back_forward'), false)
  assert.equal(typedBeforeInit('hello', '', 'prerender'), false)
  assert.equal(typedBeforeInit('hello', '', undefined), false)
  assert.equal(typedBeforeInit('', '', 'navigate'), false)
  assert.equal(typedBeforeInit('  \n', '', 'navigate'), false)
  // Server-rendered text is not user input.
  assert.equal(typedBeforeInit('hello', 'hello', 'navigate'), false)
})
