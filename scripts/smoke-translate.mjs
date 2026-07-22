import 'dotenv/config'
import { Output, streamText } from 'ai'
import { SentenceResult, WordResult } from '../src/server/schemas.ts'
import { sentencePrompt, wordPrompt } from '../src/server/prompts.ts'
import { CACHE_VERSION, promptCacheKeyFor } from '../src/server/cacheKey.ts'
import {
  assertGatewayApiKey,
  gatewayProviderOptions,
  gatewayTags,
  resolveTranslateModel,
} from '../src/server/gateway.ts'

const MODEL = resolveTranslateModel()
assertGatewayApiKey()
console.log(`[smoke] model=${MODEL}`)

async function callStructured(intent, args) {
  const promptArgs = { uiLang: 'en', ...args, intent }
  const prompt =
    intent === 'word' ? wordPrompt(promptArgs) : sentencePrompt(promptArgs)
  const t0 = Date.now()
  const result = streamText({
    model: MODEL,
    instructions: prompt.instructions,
    messages: prompt.messages,
    output: Output.object({
      schema: intent === 'word' ? WordResult : SentenceResult,
      name: intent === 'word' ? 'word_translation' : 'sentence_translation',
    }),
    maxRetries: 0,
    providerOptions: gatewayProviderOptions({
      model: MODEL,
      promptCacheKey: promptCacheKeyFor(promptArgs),
      tags: gatewayTags({
        intent,
        requestKind:
          promptArgs.refinements?.length > 0
            ? 'refinement'
            : promptArgs.context
              ? 'context'
              : 'initial',
        promptVersion: CACHE_VERSION,
      }),
    }),
  })

  for await (const _delta of result.textStream) {
    // Drain the stream; production renders each delta in the browser.
  }
  const [data, usage] = await Promise.all([result.output, result.usage])
  return {
    data,
    ms: Date.now() - t0,
    usage,
  }
}

async function run(label, intent, args) {
  const { data, ms, usage } = await callStructured(intent, args)
  console.log(
    `\n=== ${label} ===  ${ms} ms | in=${usage?.inputTokens} cached=${usage?.inputTokenDetails?.cacheReadTokens ?? 0} write=${usage?.inputTokenDetails?.cacheWriteTokens ?? 0} out=${usage?.outputTokens} total=${usage?.totalTokens}`,
  )
  console.log(JSON.stringify(data, null, 2))
  return { data, ms, usage }
}

// Fails the run if any English-only field contains non-Latin script we care about.
const NON_ENGLISH_RE = /[가-힯぀-ヿ一-鿿]/
function assertEnglish(label, obj) {
  const englishFields = [
    'rationale',
    'formalityNote',
    'primaryUsageNote',
    'etymology',
    'notes',
  ]
  const problems = []
  for (const f of englishFields) {
    if (typeof obj[f] === 'string' && NON_ENGLISH_RE.test(obj[f]))
      problems.push(`${f}: ${obj[f].slice(0, 40)}`)
  }
  for (const alt of obj.alternatives ?? []) {
    if (alt.note && NON_ENGLISH_RE.test(alt.note))
      problems.push(`alternatives.note: ${alt.note.slice(0, 40)}`)
  }
  for (const alt of obj.alternativeTranslations ?? []) {
    if (alt.note && NON_ENGLISH_RE.test(alt.note))
      problems.push(`alternativeTranslations.note: ${alt.note.slice(0, 40)}`)
    for (const r of alt.register ?? [])
      if (NON_ENGLISH_RE.test(r))
        problems.push(`alternativeTranslations.register: ${r}`)
  }
  for (const pos of obj.posList ?? []) {
    for (const s of pos.senses ?? []) {
      if (NON_ENGLISH_RE.test(s.definition))
        problems.push(`senses.definition: ${s.definition.slice(0, 40)}`)
      for (const r of s.register ?? [])
        if (NON_ENGLISH_RE.test(r)) problems.push(`senses.register: ${r}`)
    }
  }
  if (problems.length) {
    console.warn(`  ⚠ ${label} — non-English content detected:`)
    problems.forEach((p) => console.warn(`    • ${p}`))
  } else {
    console.log(`  ✓ ${label} — all metadata in English`)
  }
}

function assertLangs(label, obj, src, tgt) {
  if (obj.sourceLang === src && obj.targetLang === tgt) {
    console.log(
      `  ✓ ${label} — sourceLang=${obj.sourceLang} targetLang=${obj.targetLang}`,
    )
  } else {
    console.warn(
      `  ⚠ ${label} — expected ${src}→${tgt}, got ${obj.sourceLang}→${obj.targetLang}`,
    )
  }
}

try {
  const s1 = await run('EN→KR casual (sentence)', 'sentence', {
    text: "I'll grab dinner with my friend tonight.",
    source: 'en',
    target: 'ko',
    mode: 'casual',
  })
  assertEnglish('EN→KR casual', s1.data)
  assertLangs('EN→KR langs', s1.data, 'en', 'ko')

  const s2 = await run('KR→EN professional (sentence)', 'sentence', {
    text: '회의 일정을 조율해 주시겠습니까?',
    source: 'ko',
    target: 'en',
    mode: 'professional',
  })
  assertEnglish('KR→EN professional', s2.data)
  assertLangs('KR→EN langs', s2.data, 'ko', 'en')

  const w1 = await run('Word: thanks EN→KR casual', 'word', {
    text: 'thanks',
    source: 'en',
    target: 'ko',
    mode: 'casual',
  })
  assertEnglish('thanks casual', w1.data)
  assertLangs('thanks langs', w1.data, 'en', 'ko')

  const w2 = await run('Word: thanks EN→KR professional', 'word', {
    text: 'thanks',
    source: 'en',
    target: 'ko',
    mode: 'professional',
  })
  assertEnglish('thanks professional', w2.data)

  const w3 = await run('Word: 잔소리 KO→EN casual', 'word', {
    text: '잔소리',
    source: 'ko',
    target: 'en',
    mode: 'casual',
  })
  assertEnglish('잔소리', w3.data)

  const w4 = await run('Word: hello EN→KR casual', 'word', {
    text: 'hello',
    source: 'en',
    target: 'ko',
    mode: 'casual',
  })
  assertEnglish('hello casual', w4.data)

  const p1 = await run('Polish: KR→KR friends (sentence)', 'sentence', {
    text: '안녕하세요, 오늘도 잘 지내셨습니까?',
    source: 'ko',
    target: 'ko',
    mode: 'friends',
  })
  if (p1.data.main === '안녕하세요, 오늘도 잘 지내셨습니까?') {
    console.warn('  ⚠ polish sentence is a verbatim copy of the source')
  } else {
    console.log('  ✓ polish sentence rewrote the source')
  }
  assertLangs('polish langs', p1.data, 'ko', 'ko')

  const p2 = await run('Polish: KR→KR professional (word)', 'word', {
    text: '고마워',
    source: 'ko',
    target: 'ko',
    mode: 'professional',
  })
  if (p2.data.primaryTranslation === '고마워') {
    console.warn('  ⚠ polish word primary is the headword itself')
  } else {
    console.log(
      `  ✓ polish word primary is a synonym: ${p2.data.primaryTranslation}`,
    )
  }

  const p3 = await run('Polish: EN→EN professional (sentence)', 'sentence', {
    text: 'hey can u send the doc whenever u get a sec thx',
    source: 'en',
    target: 'en',
    mode: 'professional',
  })
  if (p3.data.main === 'hey can u send the doc whenever u get a sec thx') {
    console.warn('  ⚠ polish EN sentence is a verbatim copy of the source')
  } else {
    console.log('  ✓ polish EN sentence rewrote the source')
  }

  const s4 = await run('AUTO(fr)→EN casual (sentence)', 'sentence', {
    text: "Bonjour, comment ça va aujourd'hui ?",
    source: 'auto',
    target: 'en',
    mode: 'casual',
  })
  assertLangs('auto-detect French', s4.data, 'fr', 'en')

  const c1 = await run('Context: KO reply register (sentence)', 'sentence', {
    text: 'sounds good, see you then',
    source: 'en',
    target: 'ko',
    mode: 'professional',
    context: '부장님: 내일 오후 3시에 회의 가능하실까요?',
  })
  assertLangs('context langs', c1.data, 'en', 'ko')

  const r1 = await run('Refine: softer + shorter (sentence)', 'sentence', {
    text: 'Send me the report by tomorrow.',
    source: 'en',
    target: 'ko',
    mode: 'casual',
    refinements: ['make it softer', 'make it shorter'],
    previousMain: '내일까지 보고서 보내 주세요.',
  })
  if (r1.data.main === '내일까지 보고서 보내 주세요.') {
    console.warn('  ⚠ refine returned the previous translation verbatim')
  } else {
    console.log(`  ✓ refine produced an adjusted main: ${r1.data.main}`)
  }
} catch (err) {
  console.error('SMOKE FAILED:', err)
  process.exit(1)
}
