// Per-variant summary of a promptfoo eval from its local database: mean
// scores, wins (ties split, so config order cannot bias them), median latency
// and translation cost. Usage: node evals/summary.mjs [evalId]
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const METRICS = ['checks', 'translation', 'explanations', 'injection']
const db = new DatabaseSync(
  join(
    process.env.PROMPTFOO_CONFIG_DIR ?? join(homedir(), '.promptfoo'),
    'promptfoo.db',
  ),
  { readOnly: true },
)
const evalId =
  process.argv[2] ??
  db.prepare('SELECT id FROM evals ORDER BY created_at DESC LIMIT 1').get()?.id
if (!evalId) {
  console.log('No promptfoo evals found.')
  process.exit(0)
}

const rows = db
  .prepare(
    `SELECT test_idx,
       json_extract(provider, '$.label') ||
         CASE WHEN json_extract(provider, '$.config.promptVariant') IS NOT NULL
           THEN ' prompt=' || json_extract(provider, '$.config.promptVariant')
           ELSE '' END AS label,
       named_scores, response, cost, failure_reason
     FROM eval_results WHERE eval_id = ?`,
  )
  .all(evalId)

const variants = new Map()
const byTest = new Map()
for (const row of rows) {
  const label = row.label
  const v = variants.get(label) ?? {
    n: 0,
    errors: 0,
    cached: 0,
    scores: Object.fromEntries(METRICS.map((m) => [m, []])),
    wins: 0,
    mainMs: [],
    totalMs: [],
    cost: 0,
  }
  variants.set(label, v)
  v.n += 1
  if (row.failure_reason === 2) {
    v.errors += 1
    continue
  }
  const named = JSON.parse(row.named_scores || '{}')
  for (const m of METRICS) if (m in named) v.scores[m].push(named[m])
  const response = JSON.parse(row.response || '{}')
  if (response.cached) v.cached += 1
  // Cached responses replay old timings, so only fresh calls count.
  else {
    if (response.metadata?.mainReadyMs)
      v.mainMs.push(response.metadata.mainReadyMs)
    if (response.metadata?.totalMs) v.totalMs.push(response.metadata.totalMs)
    v.cost += row.cost ?? 0
  }
  const quality = ['translation', 'explanations']
    .filter((m) => m in named)
    .map((m) => named[m])
  if (quality.length) {
    const entries = byTest.get(row.test_idx) ?? []
    entries.push({
      label,
      score: quality.reduce((a, b) => a + b) / quality.length,
    })
    byTest.set(row.test_idx, entries)
  }
}
for (const entries of byTest.values()) {
  const best = Math.max(...entries.map((e) => e.score))
  const winners = entries.filter((e) => e.score === best)
  for (const w of winners) variants.get(w.label).wins += 1 / winners.length
}

const mean = (a) =>
  a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : '-'
const median = (a) => {
  if (!a.length) return '-'
  const s = [...a].sort((x, y) => x - y)
  return `${(s[Math.floor(s.length / 2)] / 1000).toFixed(1)}s`
}
console.log(`${evalId} (${byTest.size} cases)\n`)
console.table(
  [...variants]
    .map(([label, v]) => ({
      variant: label,
      translation: mean(v.scores.translation),
      explanations: mean(v.scores.explanations),
      checks: mean(v.scores.checks),
      injection: mean(v.scores.injection),
      wins: v.wins.toFixed(1),
      'main ready': median(v.mainMs),
      total: median(v.totalMs),
      cost: `$${v.cost.toFixed(4)}`,
      cached: v.cached,
      errors: v.errors,
    }))
    .sort((a, b) => Number(b.wins) - Number(a.wins)),
)
console.log(
  'wins: best mean of translation + explanations per case, ties split.\n' +
    'Latency and cost cover fresh calls only (cached replays excluded); judge cost is not included.',
)
