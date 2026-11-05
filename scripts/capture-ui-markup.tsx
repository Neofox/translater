// Writes go/internal/web/testdata/react-markup.json: the static markup of the
// TS app's UI primitives (Pill, Tag) and every lucide icon in
// go/internal/web/icons/names.txt, rendered by react-dom/server. The Go test
// TestPrimitivesMatchReact (go/internal/web/ui) renders the same cases with
// templ and compares tag names, attribute sets and class strings.
//
// It also fails when a lucide-react import in src/components is missing from
// names.txt, so the Go icon set cannot fall behind the TS components.
//
// Usage: npx tsx scripts/capture-ui-markup.tsx
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as lucide from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import Pill from '../src/components/ui/Pill'
import Tag from '../src/components/ui/Tag'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'go/internal/web/testdata/react-markup.json')

type Case =
  | {
      kind: 'pill'
      tone: string
      size: string
      class: string
      attrs: Record<string, string>
      html: string
    }
  | { kind: 'tag'; tone: string; html: string }
  | {
      kind: 'icon'
      name: string
      size: number
      class: string
      attrs: Record<string, string>
      html: string
    }

const icons = lucide as unknown as Record<string, ComponentType<LucideProps>>

function pascal(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

const names = readFileSync(
  join(root, 'go/internal/web/icons/names.txt'),
  'utf8',
)
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split(/\s+/)[0]!)

// Every lucide-react import in src/components must resolve to a listed icon.
const listed = new Set(names.map((name) => icons[pascal(name)]))
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}
const missing: string[] = []
for (const file of sources(join(root, 'src/components'))) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g,
  )) {
    for (const raw of match[1]!.split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0]!
      if (!name || name.startsWith('type ')) continue
      if (!icons[name]) throw new Error(`${file}: unknown lucide icon ${name}`)
      if (!listed.has(icons[name])) missing.push(`${name} (${file})`)
    }
  }
}
if (missing.length)
  throw new Error(`names.txt is missing: ${[...new Set(missing)].join(', ')}`)

const cases: Case[] = []
const label = 'Label'

for (const tone of ['neutral', 'accent', 'warm', 'active', 'primary']) {
  for (const size of ['sm', 'md']) {
    for (const [cls, attrs] of [
      ['', {}],
      ['copy-button disabled:opacity-45', { 'aria-label': 'Copy' }],
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(
          Pill,
          { tone, size, className: cls, ...attrs } as never,
          label,
        ),
      )
      cases.push({ kind: 'pill', tone, size, class: cls, attrs, html })
    }
  }
}

for (const tone of ['neutral', 'accent', 'warm']) {
  const html = renderToStaticMarkup(
    createElement(Tag, { tone } as never, label),
  )
  cases.push({ kind: 'tag', tone, html })
}

for (const name of names) {
  const Icon = icons[pascal(name)]
  if (!Icon) throw new Error(`lucide-react has no ${pascal(name)}`)
  for (const [size, cls, attrs] of [
    [18, '', {}],
    [14, 'animate-spin', {}],
    [12, 'text-accent', { 'aria-label': 'Icon' }],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(Icon, { size, className: cls || undefined, ...attrs }),
    )
    cases.push({ kind: 'icon', name, size, class: cls, attrs, html })
  }
}

writeFileSync(out, `${JSON.stringify(cases, null, 2)}\n`)
console.log(`wrote ${cases.length} cases to ${out}`)
