// Prints progress of the most recent promptfoo eval from its local database.
// promptfoo stores results as each test case finishes all variants, so the
// count advances in steps of one variant set.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dbPath = join(
  process.env.PROMPTFOO_CONFIG_DIR ?? join(homedir(), '.promptfoo'),
  'promptfoo.db',
)
const db = new DatabaseSync(dbPath, { readOnly: true })
const evalRow = db
  .prepare(
    `SELECT id, created_at, config, runtime_options,
       json_array_length(json_extract(config, '$.tests')) AS tests
     FROM evals ORDER BY created_at DESC LIMIT 1`,
  )
  .get()
if (!evalRow) {
  console.log('No promptfoo evals found.')
  process.exit(0)
}
const stats = db
  .prepare(
    `SELECT count(*) AS done,
       -- failure_reason 2 is a provider/grader error; 1 is a failed assertion.
       sum(CASE WHEN failure_reason = 2 THEN 1 ELSE 0 END) AS errors,
       sum(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS passed,
       sum(coalesce(cost, 0)) AS cost,
       max(created_at) AS last
     FROM eval_results WHERE eval_id = ?`,
  )
  .get(evalRow.id)

// Apply --filter-providers the way promptfoo does (regex on id or label).
// Other filters (--filter-pattern, --filter-first-n) shrink the run further,
// so the total is an upper bound for those runs.
const runtime = JSON.parse(evalRow.runtime_options || '{}')
const providerFilter = runtime.providerFilter
  ? new RegExp(runtime.providerFilter)
  : null
const providers = JSON.parse(evalRow.config).providers.filter(
  (p) =>
    !providerFilter ||
    providerFilter.test(p.id ?? '') ||
    providerFilter.test(p.label ?? ''),
).length
const total = providers * evalRow.tests * (runtime.repeat ?? 1)
const elapsedMin = (Date.now() - evalRow.created_at) / 60_000
const percent = total ? Math.round((stats.done / total) * 100) : 0
// Result timestamps are SQLite CURRENT_TIMESTAMP text in UTC.
const lastMin = stats.last
  ? (Date.now() - Date.parse(`${String(stats.last).replace(' ', 'T')}Z`)) /
    60_000
  : null
console.log(
  [
    evalRow.id,
    `${stats.done}/${total} results (${percent}%)`,
    `${stats.passed ?? 0} passed all checks`,
    `${stats.errors ?? 0} errors`,
    `translation cost $${(stats.cost ?? 0).toFixed(4)} (judge cost not included)`,
    `${elapsedMin.toFixed(1)} min elapsed`,
    stats.done && stats.done < total
      ? `~${((elapsedMin / stats.done) * (total - stats.done)).toFixed(0)} min left`
      : '',
    lastMin === null ? '' : `last result ${lastMin.toFixed(1)} min ago`,
  ]
    .filter(Boolean)
    .join(' | '),
)
