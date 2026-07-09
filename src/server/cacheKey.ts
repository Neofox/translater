import type { Intent, Mode } from '../lib/types'

// Bump when the response schema or prompt changes so stale entries miss.
export const CACHE_VERSION = 'v11-context-refine'

export type CacheKeyInput = {
  intent: Intent
  mode: Mode
  source: string
  target: string
  uiLang: string
  text: string
  context: string
  refinements: string[]
  previousMain: string
}

export function cacheKeyFor(d: CacheKeyInput): string {
  // refinements/previousMain are sentence-mode only — word requests must not
  // fragment the cache on fields their prompt never sees.
  const isWord = d.intent === 'word'
  return JSON.stringify([
    CACHE_VERSION,
    d.intent,
    d.mode,
    d.source,
    d.target,
    d.uiLang,
    d.text.trim(),
    d.context.trim(),
    isWord ? [] : d.refinements,
    isWord ? '' : d.previousMain,
  ])
}
