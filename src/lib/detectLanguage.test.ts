import { describe, expect, it } from 'vitest'
import { detectLanguage } from './detectLanguage'

describe('detectLanguage', () => {
  it('detects Korean from hangul', () => {
    expect(detectLanguage('안녕하세요, 오늘 뭐 해요?')).toBe('ko')
  })

  it('detects Japanese even when kanji outnumber kana', () => {
    expect(detectLanguage('図書館に行く')).toBe('ja')
  })

  it('detects Chinese from hanzi without kana', () => {
    expect(detectLanguage('我今天要去图书馆看书')).toBe('zh')
  })

  it('detects English', () => {
    expect(detectLanguage('How are you doing today?')).toBe('en')
  })

  it('distinguishes French from English', () => {
    expect(detectLanguage("Bonjour, comment ça va aujourd'hui ?")).toBe('fr')
  })

  it('distinguishes Spanish from English', () => {
    expect(
      detectLanguage(
        'Hola, ¿cómo estás hoy? Espero que todo vaya bien. Me gustaría hablar contigo sobre los planes para mañana.',
      ),
    ).toBe('es')
  })

  it('falls back to English for short ambiguous Latin text', () => {
    expect(detectLanguage('ok')).toBe('en')
  })

  it('keeps the dominant script for mixed input', () => {
    expect(detectLanguage('회의 meeting 일정 조율 부탁드려요')).toBe('ko')
  })

  it('returns null for empty input', () => {
    expect(detectLanguage('   ')).toBe(null)
  })

  it('returns null for digits and punctuation only', () => {
    expect(detectLanguage('1234 !?')).toBe(null)
  })

  it('falls back to English for an out-of-set Latin language (German)', () => {
    // tinyld with only: ['en','fr','es'] scores this well under MIN_ACCURACY
    // (~0.12), so it must fall back to 'en' rather than mis-tag as fr/es.
    expect(detectLanguage('Ich möchte heute in die Bibliothek gehen.')).toBe(
      'en',
    )
  })
})
