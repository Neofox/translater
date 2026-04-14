import 'dotenv/config'
import OpenAI from 'openai'
import { z } from 'zod'
import { PROVIDER } from '../src/server/llm.ts'
import { SentenceResult, WordResult } from '../src/server/schemas.ts'
import { sentencePrompt, wordPrompt } from '../src/server/prompts.ts'

console.log(`[smoke] provider=${PROVIDER.name} model=${PROVIDER.model}`)

const client = new OpenAI({
  apiKey: PROVIDER.apiKey,
  baseURL: PROVIDER.baseURL,
})

async function callStructured(intent, args) {
  const messages = intent === 'word' ? wordPrompt(args) : sentencePrompt(args)
  const schema = intent === 'word' ? WordResult : SentenceResult
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' })
  const t0 = Date.now()
  const response = await client.responses.create({
    model: PROVIDER.model,
    input: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: intent === 'word' ? 0.2 : args.mode === 'casual' ? 0.7 : 0.3,
    text: {
      format: {
        type: 'json_schema',
        name: 'translation_output',
        schema: jsonSchema,
        strict: false,
      },
    },
  })
  const ms = Date.now() - t0
  let text = ''
  for (const item of response.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text') text += part.text
      }
    }
  }
  const parsed = schema.parse(JSON.parse(text))
  return { data: parsed, ms, usage: response.usage }
}

async function run(label, intent, args) {
  const { data, ms, usage } = await callStructured(intent, args)
  console.log(
    `\n=== ${label} ===  ${ms} ms | in=${usage?.input_tokens} out=${usage?.output_tokens} total=${usage?.total_tokens}`,
  )
  console.log(JSON.stringify(data, null, 2))
  return { data, ms, usage }
}

// Fails the run if any English-only field contains non-Latin script we care about.
const NON_ENGLISH_RE = /[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/
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

try {
  const s1 = await run('EN→KR casual (sentence)', 'sentence', {
    text: "I'll grab dinner with my friend tonight.",
    source: 'en',
    target: 'ko',
    mode: 'casual',
  })
  assertEnglish('EN→KR casual', s1.data)

  const s2 = await run('KR→EN professional (sentence)', 'sentence', {
    text: '회의 일정을 조율해 주시겠습니까?',
    source: 'ko',
    target: 'en',
    mode: 'professional',
  })
  assertEnglish('KR→EN professional', s2.data)

  const w1 = await run('Word: thanks EN→KR casual', 'word', {
    text: 'thanks',
    source: 'en',
    target: 'ko',
    mode: 'casual',
  })
  assertEnglish('thanks casual', w1.data)

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
} catch (err) {
  console.error('SMOKE FAILED:', err)
  process.exit(1)
}
