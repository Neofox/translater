// Visual regression runner for the @visual tests (tests/visual.spec.ts).
//
//   npm run e2e:visual:update [-- <playwright args>]   write the baselines
//   npm run e2e:visual [-- <playwright args>]          compare with them
//
// Baselines are written only by the explicit update command; a plain run
// never writes one, so a missing baseline fails. Take them from the commit
// to compare against (e.g. master), then check out the change and compare.
// A --grep (-g) narrows @visual instead of replacing it: Playwright ORs
// repeated --grep flags, so the patterns become one regular expression that
// requires @visual and any of them. E2E_VISUAL=1 lets playwright.config.ts
// include @visual tests, which plain e2e runs skip.
//
//   npm run e2e:visual -- --project chromium-portrait --grep sentence-done
import { spawnSync } from 'node:child_process'

const greps = []
const rest = []
let update = false
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--update') update = true
  else if (arg === '--grep' || arg === '-g') greps.push(args[++i])
  else if (arg.startsWith('--grep=')) greps.push(arg.slice('--grep='.length))
  // -u also accepts an attached value (-uall, -u=…) and short-flag clusters (-xu).
  else if (/^-[^-]*u/.test(arg) || arg.startsWith('--update-snapshots')) {
    console.error(
      `e2e:visual: ${arg} is not allowed; write baselines with npm run e2e:visual:update.`,
    )
    process.exit(2)
  } else rest.push(arg)
}
const grep = greps.length
  ? `^(?=.*@visual)(?=.*(?:${greps.join('|')}))`
  : '@visual'

const { status } = spawnSync(
  'npx',
  [
    'playwright',
    'test',
    '-c',
    'e2e',
    '--grep',
    grep,
    ...(update ? ['--update-snapshots=all'] : []),
    ...rest,
  ],
  { stdio: 'inherit', env: { ...process.env, E2E_VISUAL: '1' } },
)
process.exit(status ?? 1)
