// Generates go/internal/learning/testdata/ts-corpus.json: seeded random
// inputs for prepareLearningResult (src/lib/learningRanges.ts) with the TS
// output, so the Go port (learning.Prepare) is checked against the real
// implementation, including Intl.Segmenter grapheme boundaries versus
// rivo/uniseg. Deterministic: rerunning produces the same file unless the
// TS logic or the runtime's segmenter changes.
//   npx tsx scripts/learning-corpus.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareLearningResult } from '../src/lib/learningRanges'

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '../go/internal/learning/testdata/ts-corpus.json',
)

// mulberry32: small seeded PRNG.
let seed = 0x5eed18
function random() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (n: number) => Math.floor(random() * n)
const pick = <T>(xs: readonly T[]) => xs[int(xs.length)]!

// Tokens mixing ASCII, Hangul, CJK, combining marks, emoji with modifiers,
// ZWJ sequences, flags, punctuation and whitespace.
const tokens = [
  'yes',
  'a',
  'ab',
  'b',
  ' ',
  ' ',
  '.',
  ',',
  '\n',
  '오늘',
  '가',
  '요',
  '학교',
  '點心',
  '懐かしい',
  'é',
  'é',
  '👍',
  '👍🏽',
  '👨‍👩‍👧',
  '🇰🇷',
  '́',
  'x',
  '—',
  '7',
  '€',
  '!',
  '줘서',
] as const

function text(max: number) {
  let s = ''
  for (let n = 1 + int(max); n > 0; n--) s += pick(tokens)
  return s
}

// A random substring by code points: may split graphemes (combining marks,
// modifiers, ZWJ sequences, flags) but never a surrogate pair, which JSON
// cannot carry to Go intact.
function slice(s: string) {
  const cps = Array.from(s)
  if (!cps.length) return ''
  const a = int(cps.length)
  return cps.slice(a, a + 1 + int(Math.min(6, cps.length - a))).join('')
}

function quote(s: string) {
  return random() < 0.8 ? slice(s) : text(2)
}

const notes = [
  {
    word: '학교',
    chars: [
      { char: '學', meaning: 'm' },
      { char: '校', meaning: 'm' },
    ],
  },
  { word: '학교', chars: [{ char: '學', meaning: 'm' }] },
  {
    word: '點心',
    chars: [
      { char: '點', meaning: 'm' },
      { char: '心', meaning: 'm' },
    ],
  },
  { word: '懐かしい', chars: [{ char: '懐', meaning: 'm' }] },
  {
    word: '오늘',
    chars: [
      { char: '오', meaning: 'm' },
      { char: '늘', meaning: 'm' },
    ],
  },
  { word: 'yes', chars: [] },
]

const cases = []
for (let i = 0; i < 600; i++) {
  const primary = text(14)
  const counterpart = text(10)
  const phrases = Array.from({ length: int(6) }, () => {
    const t = quote(primary)
    return {
      text: t,
      gloss: 'g',
      sourceTexts: Array.from({ length: int(3) }, () => quote(counterpart)),
      baseForm: '',
      literalMeaning: '',
      naturalMeaning: '',
      grammar: pick(['', ' ', 'grammar']),
      omissions: '',
      grammarHighlights: Array.from({ length: int(4) }, () => quote(t)),
      usageNote: '',
      characters: Array.from({ length: int(3) }, () => pick(notes)),
    }
  })
  // Sometimes repeat a phrase to exercise ordered disambiguation.
  if (phrases.length && random() < 0.3) phrases.push(pick(phrases))
  const result = prepareLearningResult(counterpart, primary, phrases)
  cases.push({
    counterpart,
    primary,
    // Empty strings are left out to keep the file small (Go zero values).
    phrases: phrases.map((p) =>
      Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '')),
    ),
    want: result && {
      partial: result.partial,
      chunks: result.chunks.map((c) => ({
        start: c.start,
        end: c.end,
        text: c.text,
        grammarHighlights: c.grammarHighlights,
        sourceSpans: c.sourceSpans,
        characters: (c.characters ?? []).map((n) => n.word),
      })),
    },
  })
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(cases) + '\n')
console.log(
  `${cases.length} cases, ${cases.filter((c) => c.want).length} with a result → ${out}`,
)
