// `npm run e2e:visual [-- <playwright args>]`: the TS production build
// writes the baselines, then the Go app is compared with them. Every
// argument applies to both runs, so they cover the same projects and
// states. A --grep (-g) narrows @visual instead of replacing it: Playwright
// ORs repeated --grep flags, so the patterns become one regular expression
// that requires @visual and any of them. E2E_VISUAL=1 lets
// playwright.config.ts include @visual tests, which plain e2e runs skip.
//
//   npm run e2e:visual -- --project chromium-portrait --grep sentence-done
import { spawnSync } from 'node:child_process'

const greps = []
const rest = []
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--grep' || arg === '-g') greps.push(args[++i])
  else if (arg.startsWith('--grep=')) greps.push(arg.slice('--grep='.length))
  else rest.push(arg)
}
const grep = greps.length
  ? `^(?=.*@visual)(?=.*(?:${greps.join('|')}))`
  : '@visual'

function playwright(env, extra) {
  const { status } = spawnSync(
    'npx',
    ['playwright', 'test', '-c', 'e2e', '--grep', grep, ...extra, ...rest],
    { stdio: 'inherit', env: { ...process.env, E2E_VISUAL: '1', ...env } },
  )
  return status ?? 1
}

const ts = playwright({ APP: 'ts', E2E_TS_BUILD: 'prod' }, [
  '--update-snapshots=all',
])
if (ts !== 0) {
  console.error('e2e:visual: the TS baseline run failed; the Go run is skipped.')
  process.exit(ts)
}
process.exit(playwright({ APP: 'go' }, []))
